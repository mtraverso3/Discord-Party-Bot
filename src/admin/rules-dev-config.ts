// TEMPORARY — the real content.py, lifted so the local rules preview shows
// what members would actually read. Deleted along with rules-dev.ts.

export const DEV_RULES_CONFIG = {
  "version": "1",
  "pages": [
    {
      "title": "Arena In-House Rules & Conduct — General Mindset",
      "text": "We are playing for content. This involves runtime (not instant rounds), interesting builds/opponents (not Infinity Edge on 4 with Sword of the Divine Caitlyn looking to one-shot), and a story/narrative (largely outside your control, but part of what the content creators' team needs to do).\n\n• Do NOT just pick your main and play as if this is a tournament you need to win.\n• Do NOT let the content creators' team win on purpose EVER. A hint of collusion makes the video worse. It is better to kill their run than deliberately lose.\n• Your Round 4/6 buys should generally match lobby tempo. Pushing a triple-DPS composition too far forces the lobby to follow and can cut off interesting scaling compositions. Look around, especially at the content creators' team, before choosing your buys.\n• Do NOT eliminate teams other than the content creators' team before Round 8. Garen can give a team an extra life for more runtime; this happens off-camera.\n• Do NOT play Bravery if you cannot be creative with the champion/team composition presented. If needed, move to a different voice channel to coordinate. You remain responsible for your pick.\n• Do NOT lock in super-meta triple-DPS or ADC/support combinations with standard builds, or S-tier champions in general. This takes judgment: think carefully about your picks.\n• No stat running: do not go only stat anvils."
    },
    {
      "title": "Behavior & Attitude",
      "text": "• Do not get defensive about call-outs or rulings. Defensiveness or passive aggression receives a single warning; arguing holds up the other 17 people.\n• Do not flame, act antisocially, or be passive aggressive in voice chat. Behave maturely.\n• Report unresolved issues to the host immediately if you cannot sort them out yourselves.\n• Do not act like a class clown in-game to get attention: disruptive party chat, switching votes back and forth, hitting blast cones during voting, or emoting on top of the creators' characters in the lobby.\n• DO NOT HIT BLAST CONES.\n• Do not get an ego over these custom games. Absolutely zero main-character energy."
    },
    {
      "title": "Session Instructions & Other Restrictions",
      "text": "• No Clothesline or Pinball.\n• Always vote with the content creators' team during Guest of Honor (GoH), the mid-game event. Do not mess around during voting.\n• Respond to recruitment pings only if you CAN play. Do not reply with “I would, but…” messages when unavailable.\n• Read everything the host writes fully.\n• Clarifying questions are welcome, but think about the question first.\n• Games are on NA. If connecting from another region, your ping must be good enough to play properly.\n• If these rules are too cumbersome, do not sign up. They are necessary.\n• Be ready to Alt-F4 when the content creators' team says “leave”; otherwise follow “stay.” Instructions are reinforced in the Discord call. Keep all-chat enabled for further in-game instructions.\n• Ban the champion assigned by the existing queue bot when you join.\n\nThroughout these rules, “us” and “ours” mean the content creators' team."
    }
  ],
  "questions": [
    {
      "text": "You can beat the content creators' team. What should you do?",
      "correct": [
        "Compete honestly within the rules."
      ],
      "incorrect": [
        "Deliberately lose.",
        "Stop attacking to extend their run."
      ],
      "explanation": "Never intentionally let the content creators' team win. Honest competition makes better content."
    },
    {
      "text": "Before Round 8, may you eliminate a team other than the content creators' team?",
      "correct": [
        "No."
      ],
      "incorrect": [
        "Yes, if they are weak.",
        "Only if your teammate agrees."
      ],
      "explanation": "Do not eliminate other teams before Round 8. The content creators' team is the exception."
    },
    {
      "text": "What should guide your Round 4/6 purchases?",
      "correct": [
        "Check lobby tempo, especially the content creators' team, and buy accordingly."
      ],
      "incorrect": [
        "Maximum damage regardless of the lobby.",
        "Always buy nothing."
      ],
      "explanation": "Match lobby tempo generally. Look around, especially at the content creators' team."
    },
    {
      "text": "You select Bravery. What are you responsible for?",
      "correct": [
        "Make creative choices; coordinate in another voice channel if needed."
      ],
      "incorrect": [
        "Nothing: the random pick excuses your build.",
        "Always copy the strongest standard build."
      ],
      "explanation": "Bravery does not excuse your choices. You remain responsible for your champion and composition."
    },
    {
      "text": "While waiting during voting, what should you avoid?",
      "correct": [
        "Hitting blast cones or disrupting voting to get attention."
      ],
      "incorrect": [
        "Following instructions.",
        "Waiting for the creators' vote."
      ],
      "explanation": "Do not hit blast cones or disrupt voting. No attention-seeking behavior."
    },
    {
      "text": "The content creators' team says 'leave.' What should you do?",
      "correct": [
        "Alt-F4 as instructed; keep all-chat enabled for game instructions."
      ],
      "incorrect": [
        "Finish the round first.",
        "Decide by a separate team vote."
      ],
      "explanation": "Follow the creators' leave/stay instructions. Keep all-chat on; the Discord call reinforces instructions."
    },
    {
      "text": "During Guest of Honor, what must you do?",
      "correct": [
        "Vote with the content creators' team and keep the process orderly."
      ],
      "incorrect": [
        "Vote randomly.",
        "Repeatedly switch votes as a joke."
      ],
      "explanation": "Guest of Honor is the mid-game event. Always vote with the content creators' team."
    },
    {
      "text": "Which approach follows the gameplay restrictions?",
      "correct": [
        "Avoid stat-only anvil builds, Clothesline, and Pinball."
      ],
      "incorrect": [
        "Go only stat anvils.",
        "Use Clothesline or Pinball if your teammate agrees."
      ],
      "explanation": "Stat running means going only stat anvils. Clothesline and Pinball are also prohibited."
    },
    {
      "text": "When should you respond to a recruitment ping, and what must you do about your assigned ban?",
      "correct": [
        "Respond only when you can play; ban the champion assigned by the queue bot."
      ],
      "incorrect": [
        "Respond even if unavailable; choose any ban.",
        "Respond if you might watch; ignore the assigned ban."
      ],
      "explanation": "Only respond when available to play. Follow the existing queue bot's champion-ban assignment."
    },
    {
      "text": "How should you handle a ruling or an unresolved conduct issue?",
      "correct": [
        "Follow rulings without defensiveness; promptly report unresolved issues to the host."
      ],
      "incorrect": [
        "Argue until the lobby agrees.",
        "Retaliate in voice chat."
      ],
      "explanation": "No defensiveness, flaming, or passive aggression. Report unresolved issues to the host promptly."
    }
  ],
  "agreement": "I have read the complete Arena In-House Rules & Conduct and agree to follow them.\n\nI understand that these games prioritize content, creativity, and lobby pacing while still requiring honest competition. I will not intentionally let the content creators' team win.\n\nI will follow the gameplay restrictions, conduct expectations, voting instructions, assigned champion ban, and leave/stay directions. If a rule is unclear, I will ask before joining the queue."
} as const
