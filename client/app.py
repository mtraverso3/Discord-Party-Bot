"""PartyBot desktop client.

Connects to the local League of Legends client (LCU API) and syncs with a
Discord party hosted by the PartyBot Cloudflare Worker. Owners can create a
lobby and invite all registered party members in one click; members can wait
for an invite from the owner and auto-accept it.

To build a standalone executable:
    pip install pyinstaller
    pyinstaller --onefile --windowed client/app.py
"""

import asyncio
import queue
import ssl
import threading
import tkinter as tk
from tkinter import ttk
from typing import Any, Callable, Optional

import aiohttp
import psutil

# ── Config ────────────────────────────────────────────────────────────────────

BOT_BASE_URL = "https://partybot.mtraverso.net"  # set this to your deployed Worker
POLL_INTERVAL_MS = 2000
LEAGUE_QUEUE_ID_CUSTOM = 1750  # Summoner's Rift custom (Tournament Draft is 6 / custom is 1750)

# ── LCU client (no third-party LCU lib — psutil + aiohttp) ───────────────────

LCU_PROCESS_NAMES = ("LeagueClientUx.exe", "LeagueClientUx")


def find_lcu() -> Optional[tuple[int, str]]:
    """Return (app_port, remoting_auth_token) of a running LeagueClientUx, or None."""
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            name = proc.info.get("name")
            if name not in LCU_PROCESS_NAMES:
                continue
            port: Optional[str] = None
            token: Optional[str] = None
            for arg in proc.info.get("cmdline") or []:
                if arg.startswith("--app-port="):
                    port = arg.split("=", 1)[1]
                elif arg.startswith("--remoting-auth-token="):
                    token = arg.split("=", 1)[1]
            if port and token:
                return int(port), token
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


class LcuClient:
    """Minimal client for the local LCU HTTPS endpoint."""

    def __init__(self, port: int, token: str) -> None:
        self.port = port
        self.token = token
        self.base = f"https://127.0.0.1:{port}"
        self.auth = aiohttp.BasicAuth("riot", token)
        # LCU uses a self-signed cert.
        self.ssl_ctx = ssl.create_default_context()
        self.ssl_ctx.check_hostname = False
        self.ssl_ctx.verify_mode = ssl.CERT_NONE

    async def request(self, method: str, path: str, data: Any = None) -> tuple[int, Any]:
        connector = aiohttp.TCPConnector(ssl=self.ssl_ctx)
        async with aiohttp.ClientSession(connector=connector, auth=self.auth) as s:
            kwargs: dict[str, Any] = {}
            if data is not None:
                kwargs["json"] = data
            async with s.request(method, f"{self.base}{path}", **kwargs) as r:
                try:
                    body = await r.json(content_type=None)
                except Exception:
                    body = None
                return r.status, body


# ── Async loop running in background thread ──────────────────────────────────

class AsyncRunner:
    """Owns a persistent asyncio loop running on a dedicated thread."""

    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def submit(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    def call_soon(self, fn, *args):
        self.loop.call_soon_threadsafe(fn, *args)


# ── App ──────────────────────────────────────────────────────────────────────

STATE_CONNECTING = "connecting"
STATE_LINKED = "linked"
STATE_IN_PARTY = "in_party"


class PartyBotApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("PartyBot")
        self.root.geometry("440x520")
        self.root.minsize(420, 480)

        # UI -> main-thread update queue (lambdas posted from async tasks).
        self.ui_queue: "queue.Queue[Callable[[], None]]" = queue.Queue()

        # Async runner.
        self.runner = AsyncRunner()

        # LCU state.
        self.lcu_connection: Any = None
        self.summoner_id: Optional[int] = None
        self.puuid: Optional[str] = None
        self.summoner_name: Optional[str] = None

        # Party / link state.
        self.link_code: Optional[str] = None
        self.party: Optional[dict] = None
        self.is_owner: bool = False

        # Background tasks.
        self.refresh_task: Optional[asyncio.Task] = None
        self.sync_task: Optional[asyncio.Task] = None
        self.sync_on: bool = False

        self.state: str = STATE_CONNECTING

        self._build_ui()
        self._render()

        # Start LCU connector.
        self.runner.submit(self._start_lcu())

        # Pump UI updates from background.
        self.root.after(50, self._pump_ui_queue)

    # ── UI build ──────────────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=16)
        outer.pack(fill="both", expand=True)

        header = ttk.Label(outer, text="PartyBot", font=("TkDefaultFont", 16, "bold"))
        header.pack(anchor="w")
        ttk.Separator(outer).pack(fill="x", pady=(6, 12))

        self.lcu_label = ttk.Label(outer, text="LCU: ...")
        self.lcu_label.pack(anchor="w", pady=(0, 12))

        # Code entry frame (State 2).
        self.code_frame = ttk.Frame(outer)
        ttk.Label(self.code_frame, text="Link Code").grid(row=0, column=0, sticky="w")
        self.code_entry = ttk.Entry(self.code_frame, width=14)
        self.code_entry.grid(row=0, column=1, padx=(8, 8))
        self.connect_btn = ttk.Button(self.code_frame, text="Connect", command=self._on_connect)
        self.connect_btn.grid(row=0, column=2)
        ttk.Label(
            self.code_frame,
            text="Get your code with /party link in Discord.",
            foreground="#666",
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 0))
        self.code_error = ttk.Label(self.code_frame, text="", foreground="#c44")
        self.code_error.grid(row=2, column=0, columnspan=3, sticky="w", pady=(4, 0))

        # Party frame (State 3).
        self.party_frame = ttk.Frame(outer)
        self.party_title = ttk.Label(self.party_frame, text="", font=("TkDefaultFont", 12, "bold"))
        self.party_title.pack(anchor="w")
        self.party_role = ttk.Label(self.party_frame, text="")
        self.party_role.pack(anchor="w", pady=(0, 8))
        ttk.Label(self.party_frame, text="Members:").pack(anchor="w")
        bg = ttk.Style().lookup("TFrame", "background") or self.root.cget("background")
        self.members_text = tk.Text(self.party_frame, height=8, width=44, state="disabled",
                                    relief="flat", background=bg)
        self.members_text.pack(anchor="w", fill="x", pady=(2, 10))

        self.action_btn = ttk.Button(self.party_frame, text="", command=self._on_action)
        self.action_btn.pack(fill="x", pady=(0, 8))

        self.status_label = ttk.Label(self.party_frame, text="Status: —", foreground="#444")
        self.status_label.pack(anchor="w", pady=(0, 8))

        ttk.Separator(self.party_frame).pack(fill="x", pady=(2, 8))
        self.disconnect_btn = ttk.Button(self.party_frame, text="Disconnect", command=self._on_disconnect)
        self.disconnect_btn.pack(anchor="w")

    # ── UI render ─────────────────────────────────────────────────────────────

    def _render(self) -> None:
        # LCU label.
        if self.lcu_connection is None:
            self.lcu_label.config(text="LCU:  ⟳ Waiting for League client...")
        else:
            self.lcu_label.config(text=f"LCU:  ●  {self.summoner_name or 'connected'}")

        # Show/hide frames.
        self.code_frame.pack_forget()
        self.party_frame.pack_forget()

        if self.state == STATE_LINKED:
            self.code_frame.pack(anchor="w", fill="x")
            self.code_entry.focus_set()
        elif self.state == STATE_IN_PARTY:
            self.party_frame.pack(anchor="w", fill="both", expand=True)
            self._render_party()

    def _render_party(self) -> None:
        if not self.party:
            return
        self.party_title.config(text=f"Party: {self.party['partyName']}  ({self.party['partyId']})")
        if self.is_owner:
            self.party_role.config(text="You are the party owner.")
            self.action_btn.config(text="Create Lobby & Invite All")
        else:
            owner_name = next(
                (m["displayName"] for m in self.party["members"] if m.get("isOwner")),
                "?",
            )
            self.party_role.config(text=f"Owner: {owner_name}")
            self.action_btn.config(text=("■  Stop Sync" if self.sync_on else "●  Start Sync"))

        # Members list.
        self.members_text.config(state="normal")
        self.members_text.delete("1.0", "end")
        for m in self.party["members"]:
            mark = "✓" if m.get("summonerId") is not None else "○"
            tags = []
            if m.get("isOwner"):
                tags.append("owner")
            if self.summoner_id is not None and m.get("summonerId") == self.summoner_id:
                tags.append("you")
            tag_str = f"  ({', '.join(tags)})" if tags else ""
            self.members_text.insert("end", f"  {mark}  {m['displayName']}{tag_str}\n")
        self.members_text.config(state="disabled")

    # ── UI queue pump ─────────────────────────────────────────────────────────

    def _pump_ui_queue(self) -> None:
        try:
            while True:
                fn = self.ui_queue.get_nowait()
                try:
                    fn()
                except Exception as e:
                    print(f"UI update error: {e}")
        except queue.Empty:
            pass
        self.root.after(50, self._pump_ui_queue)

    def ui(self, fn: Callable[[], None]) -> None:
        """Schedule a UI update from any thread."""
        self.ui_queue.put(fn)

    def set_status(self, text: str) -> None:
        self.ui(lambda: self.status_label.config(text=f"Status: {text}"))

    def set_code_error(self, text: str) -> None:
        self.ui(lambda: self.code_error.config(text=text))

    # ── LCU ───────────────────────────────────────────────────────────────────

    async def _start_lcu(self) -> None:
        """Poll for the LCU process, attach to it, detect disconnect, repeat."""
        while True:
            if self.lcu_connection is None:
                found = find_lcu()
                if found is not None:
                    port, token = found
                    client = LcuClient(port, token)
                    try:
                        status, data = await client.request("get", "/lol-summoner/v1/current-summoner")
                    except Exception as e:
                        print(f"LCU summoner fetch failed: {e}")
                        status, data = 0, None
                    if status == 200 and isinstance(data, dict) and data.get("summonerId"):
                        self.lcu_connection = client
                        self.summoner_id = data.get("summonerId")
                        self.puuid = data.get("puuid")
                        self.summoner_name = (
                            data.get("displayName") or data.get("gameName") or "summoner"
                        )
                        self.state = STATE_LINKED
                        self.ui(self._render)
            else:
                # Verify the client is still up; if not, drop back to "waiting".
                try:
                    status, _ = await self.lcu_connection.request(
                        "get", "/lol-summoner/v1/current-summoner",
                    )
                    alive = status == 200
                except Exception:
                    alive = False
                if not alive:
                    self.lcu_connection = None
                    self.summoner_id = None
                    self.puuid = None
                    self.summoner_name = None
                    self._stop_background_tasks()
                    self.party = None
                    self.link_code = None
                    self.is_owner = False
                    self.sync_on = False
                    self.state = STATE_CONNECTING
                    self.ui(self._render)
            await asyncio.sleep(2)

    # ── HTTP to bot ───────────────────────────────────────────────────────────

    async def _bot_get(self, path: str) -> tuple[int, Any]:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{BOT_BASE_URL}{path}") as r:
                try:
                    body = await r.json(content_type=None)
                except Exception:
                    body = None
                return r.status, body

    async def _bot_post(self, path: str, payload: dict) -> tuple[int, Any]:
        async with aiohttp.ClientSession() as s:
            async with s.post(f"{BOT_BASE_URL}{path}", json=payload) as r:
                try:
                    body = await r.json(content_type=None)
                except Exception:
                    body = None
                return r.status, body

    async def _bot_delete(self, path: str) -> tuple[int, Any]:
        async with aiohttp.ClientSession() as s:
            async with s.delete(f"{BOT_BASE_URL}{path}") as r:
                try:
                    body = await r.json(content_type=None)
                except Exception:
                    body = None
                return r.status, body

    # ── Connect via link code ─────────────────────────────────────────────────

    def _on_connect(self) -> None:
        code = self.code_entry.get().strip().upper()
        if not code:
            self.set_code_error("Enter a link code.")
            return
        if self.summoner_id is None or self.puuid is None:
            self.set_code_error("League client not connected.")
            return
        self.set_code_error("")
        self.connect_btn.config(state="disabled")
        self.runner.submit(self._connect_with_code(code))

    async def _connect_with_code(self, code: str) -> None:
        try:
            status, body = await self._bot_get(f"/lcu/link/{code}")
            if status == 404:
                self.set_code_error("Code not found or expired.")
                return
            if status != 200 or not isinstance(body, dict):
                self.set_code_error(f"Bot returned {status}.")
                return

            reg_status, _ = await self._bot_post(
                f"/lcu/link/{code}/register",
                {"summonerId": self.summoner_id, "puuid": self.puuid},
            )
            if reg_status != 200:
                self.set_code_error(f"Registration failed ({reg_status}).")
                return

            self.link_code = code
            self.party = body
            self.is_owner = bool(body.get("isOwner"))
            self.sync_on = False
            self.state = STATE_IN_PARTY
            self.ui(self._render)

            # Start party refresh polling.
            self._start_refresh()
        except aiohttp.ClientError as e:
            self.set_code_error(f"Bot unreachable: {e}")
        except Exception as e:
            self.set_code_error(f"Error: {e}")
        finally:
            self.ui(lambda: self.connect_btn.config(state="normal"))

    # ── Party refresh ─────────────────────────────────────────────────────────

    def _start_refresh(self) -> None:
        if self.refresh_task and not self.refresh_task.done():
            return
        self.refresh_task = self.runner.loop.create_task(self._refresh_loop())

    async def _refresh_loop(self) -> None:
        while self.link_code is not None:
            await asyncio.sleep(POLL_INTERVAL_MS / 1000)
            if self.link_code is None:
                break
            try:
                status, body = await self._bot_get(f"/lcu/link/{self.link_code}")
                if status == 200 and isinstance(body, dict):
                    self.party = body
                    self.is_owner = bool(body.get("isOwner"))
                    self.ui(self._render_party)
                elif status == 404:
                    # Code expired or party gone — drop back to State 2.
                    self.set_status("Link expired.")
                    self._reset_to_linked()
                    return
            except Exception as e:
                print(f"Refresh error: {e}")

    # ── Action button (owner: create lobby / member: toggle sync) ─────────────

    def _on_action(self) -> None:
        if not self.party:
            return
        if self.is_owner:
            self.runner.submit(self._create_lobby_and_invite())
        else:
            if self.sync_on:
                self._stop_sync()
            else:
                self._start_sync()
            self._render_party()

    async def _create_lobby_and_invite(self) -> None:
        if self.lcu_connection is None or self.party is None:
            return
        try:
            self.set_status("Creating lobby...")
            status, _ = await self.lcu_connection.request(
                "post", "/lol-lobby/v2/lobby", data={"queueId": LEAGUE_QUEUE_ID_CUSTOM},
            )
            if status >= 400:
                self.set_status(f"Lobby create failed ({status}).")
                return

            invitees = [
                {"toSummonerId": m["summonerId"]}
                for m in self.party["members"]
                if m.get("summonerId") is not None and m["summonerId"] != self.summoner_id
            ]
            if not invitees:
                self.set_status("Lobby created — no other members registered yet.")
                return

            status2, _ = await self.lcu_connection.request(
                "post", "/lol-lobby/v2/lobby/invitations", data=invitees,
            )
            if status2 >= 400:
                self.set_status(f"Lobby created — invitations failed ({status2}).")
                return
            self.set_status(f"Lobby created — {len(invitees)} invitation(s) sent.")
        except Exception as e:
            self.set_status(f"Error: {e}")

    # ── Member sync ───────────────────────────────────────────────────────────

    def _start_sync(self) -> None:
        if self.sync_task and not self.sync_task.done():
            return
        self.sync_on = True
        self.set_status("Waiting for invite...")
        self.sync_task = self.runner.loop.create_task(self._sync_loop())

    def _stop_sync(self) -> None:
        self.sync_on = False
        if self.sync_task:
            self.sync_task.cancel()
            self.sync_task = None
        self.set_status("Sync stopped.")

    async def _sync_loop(self) -> None:
        try:
            while self.sync_on and self.lcu_connection is not None and self.party is not None:
                owner_summ = self.party.get("ownerSummonerId")
                if owner_summ:
                    try:
                        status, body = await self.lcu_connection.request(
                            "get", "/lol-lobby/v2/received-invitations",
                        )
                        invites = body if status == 200 and isinstance(body, list) else []
                    except Exception as e:
                        invites = []
                        print(f"Invitation poll error: {e}")

                    for inv in invites or []:
                        if (
                            inv.get("state") == "Pending"
                            and inv.get("fromSummonerId") == owner_summ
                        ):
                            inv_id = inv.get("invitationId")
                            try:
                                ast, _ = await self.lcu_connection.request(
                                    "post",
                                    f"/lol-lobby/v2/received-invitations/{inv_id}/accept",
                                )
                                if ast < 400:
                                    self.set_status("✓ Joined lobby.")
                                    self.sync_on = False
                                    self.ui(self._render_party)
                                    return
                            except Exception as e:
                                self.set_status(f"Accept failed: {e}")
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            pass

    # ── Disconnect ────────────────────────────────────────────────────────────

    def _on_disconnect(self) -> None:
        code = self.link_code
        self._stop_background_tasks()
        self.party = None
        self.link_code = None
        self.is_owner = False
        self.sync_on = False
        if self.lcu_connection is not None:
            self.state = STATE_LINKED
        else:
            self.state = STATE_CONNECTING
        self._render()
        if code:
            self.runner.submit(self._bot_delete(f"/lcu/link/{code}/register"))

    def _stop_background_tasks(self) -> None:
        for t in (self.refresh_task, self.sync_task):
            if t and not t.done():
                self.runner.call_soon(t.cancel)
        self.refresh_task = None
        self.sync_task = None

    def _reset_to_linked(self) -> None:
        self._stop_background_tasks()
        self.party = None
        self.link_code = None
        self.is_owner = False
        self.sync_on = False
        self.state = STATE_LINKED if self.lcu_connection else STATE_CONNECTING
        self.ui(self._render)


def main() -> None:
    root = tk.Tk()
    PartyBotApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
