import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { DiscordRequest } from './utils.js';
import PlayerManager from './ignmanager.js';

const app = express();
const PORT = process.env.PORT || 3000;
const activeParties = {};
const playerManager = new PlayerManager();

function embedColor(party) {
  if (party.members.length >= party.userLimit) return 0xfee75c; // yellow = full
  return 0x57f287; // green = open
}

function buildPartyEmbed(party) {
  const isFull = party.members.length >= party.userLimit;
  const statusLabel = isFull ? '🟡 FULL' : '🟢 OPEN';

  const memberLines = party.members.length
    ? party.members
        .map((memberId, i) => {
          const ign = playerManager.get(memberId, party.gameName);
          const crown = memberId === party.createdBy ? ' 👑' : '';
          return `\`${i + 1}.\` <@${memberId}>${crown}${ign ? ` *(${ign})*` : ''}`;
        })
        .join('\n')
    : '*No members yet*';

  const fields = [
    { name: `Members — ${party.members.length}/${party.userLimit}`, value: memberLines },
  ];

  if (party.vcLink && party.vcLink !== 'No voice channel') {
    fields.push({ name: 'Voice Channel', value: `<#${party.vcLink}>`, inline: true });
  }

  const waitlist = party.waitlist || [];
  if (waitlist.length > 0) {
    const queueLines = waitlist
      .map((memberId, i) => {
        const ign = playerManager.get(memberId, party.gameName);
        return `\`${i + 1}.\` <@${memberId}>${ign ? ` *(${ign})*` : ''}`;
      })
      .join('\n');
    fields.push({ name: `Queue — ${waitlist.length} waiting`, value: queueLines });
  }

  return {
    title: party.partyName,
    color: embedColor(party),
    fields,
    footer: { text: `${party.gameName} · ${statusLabel}` },
    timestamp: new Date(party.createdAt).toISOString(),
  };
}

function buildPartyComponents(party) {
  const isFull = party.members.length >= party.userLimit;

  const joinButton = isFull
    ? { type: MessageComponentTypes.BUTTON, style: ButtonStyleTypes.SECONDARY, label: 'Join Queue', custom_id: `join_party_${party.partyId}` }
    : { type: MessageComponentTypes.BUTTON, style: ButtonStyleTypes.SUCCESS, label: 'Join', custom_id: `join_party_${party.partyId}` };

  return [{
    type: MessageComponentTypes.ACTION_ROW,
    components: [
      joinButton,
      { type: MessageComponentTypes.BUTTON, style: ButtonStyleTypes.DANGER, label: 'Leave', custom_id: `leave_party_${party.partyId}` },
    ],
  }];
}

function isAdminUser(req) {
  const adminUserId = process.env.ADMIN_USER_ID;
  const hasAdminBit = req.body.member?.permissions
    ? (BigInt(req.body.member.permissions) & 0x8n) === 0x8n
    : false;

  return hasAdminBit || (adminUserId && req.body.user?.id === adminUserId);
}

app.post('/interactions', verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY), async function (req, res) {
  const { id, type, data } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'party') {
      const subcommand = req.body.data.options?.[0]?.name;
      const suboptions = req.body.data.options?.[0]?.options || [];
      const getOption = (optionName) => suboptions.find((option) => option.name === optionName)?.value;
      const context = req.body.context;
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      if (subcommand === 'create') {
        const userMention = `<@${userId}>`;
        const partyName = getOption('name') || `${userMention}'s party`;
        const userLimit = parseInt(getOption('user_limit') || '0', 10);
        const vcLink = getOption('voice_channel') || 'No voice channel';
        const gameName = getOption('game_name') || 'Other';

        activeParties[id] = {
          partyId: id,
          partyName,
          userLimit,
          vcLink,
          gameName,
          members: [userId],
          waitlist: [],
          createdBy: userId,
          createdAt: Date.now(),
          token: req.body.token,
        };

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [buildPartyEmbed(activeParties[id])],
            components: buildPartyComponents(activeParties[id]),
          },
        });
      } else if (subcommand === 'add') {
        const targetUserId = getOption('user');
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You do not have a party to add members to.' },
          });
        }

        if (!targetUserId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Please select a user to add.' },
          });
        }

        if (!party.members.includes(targetUserId)) {
          party.members.push(targetUserId);
        }

        const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
        try {
          await DiscordRequest(updateEndpoint, {
            method: 'PATCH',
            body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
          });
        } catch (err) {
          console.error('Error updating party message after add:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Added <@${targetUserId}> to ${party.partyName}. (${party.members.length}/${party.userLimit})`,
          },
        });
      } else if (subcommand === 'remove') {
        const targetUserId = getOption('user');
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You do not have a party to remove members from.' },
          });
        }

        if (!targetUserId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Please select a user to remove.' },
          });
        }

        party.members = party.members.filter((memberId) => memberId !== targetUserId);
        party.waitlist = party.waitlist || [];
        if (party.members.length < party.userLimit && party.waitlist.length) {
          const promotedUser = party.waitlist.shift();
          if (!party.members.includes(promotedUser)) party.members.push(promotedUser);
        }

        const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
        try {
          if (party.members.length === 0) {
            delete activeParties[party.partyId];
            await DiscordRequest(updateEndpoint, { method: 'DELETE' });
          } else {
            await DiscordRequest(updateEndpoint, {
              method: 'PATCH',
              body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
            });
          }
        } catch (err) {
          console.error('Error updating party message after remove:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Removed <@${targetUserId}> from ${party.partyName}. (${party.members.length}/${party.userLimit})`,
          },
        });
      } else if (subcommand === 'ban') {
        const targetUserId = getOption('user');
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You do not have a party to ban users from.' },
          });
        }

        if (!targetUserId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Please select a user to ban.' },
          });
        }

        if (targetUserId === userId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You cannot ban yourself.' },
          });
        }

        party.bannedUsers = party.bannedUsers || [];
        if (!party.bannedUsers.includes(targetUserId)) party.bannedUsers.push(targetUserId);

        party.members = party.members.filter((memberId) => memberId !== targetUserId);
        party.waitlist = (party.waitlist || []).filter((memberId) => memberId !== targetUserId);

        if (party.members.length < party.userLimit && party.waitlist.length) {
          const promotedUser = party.waitlist.shift();
          if (!party.members.includes(promotedUser)) party.members.push(promotedUser);
        }

        const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
        try {
          if (party.members.length === 0) {
            delete activeParties[party.partyId];
            await DiscordRequest(updateEndpoint, { method: 'DELETE' });
          } else {
            await DiscordRequest(updateEndpoint, {
              method: 'PATCH',
              body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
            });
          }
        } catch (err) {
          console.error('Error updating party message after ban:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: `Banned <@${targetUserId}> from ${party.partyName}.` },
        });
      } else if (subcommand === 'changevc') {
        const newVcChannel = getOption('voice_channel');
        const party = Object.values(activeParties).find((party) => party.members.includes(userId));

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You are not in a party to change the voice channel for.' },
          });
        }

        if (!newVcChannel) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Please select a voice channel.' },
          });
        }

        party.vcLink = newVcChannel;
        const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
        try {
          await DiscordRequest(updateEndpoint, {
            method: 'PATCH',
            body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
          });
        } catch (err) {
          console.error('Error updating party message after changevc:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: `Changed voice channel to <#${newVcChannel}>.` },
        });
      } else if (subcommand === 'invite') {
        const inviteMessage = getOption('message');
        const inviteUserIds = ['user1', 'user2', 'user3', 'user4', 'user5', 'user6']
          .map((name) => getOption(name))
          .filter(Boolean);
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You do not have a party to invite users to.' },
          });
        }

        if (!inviteMessage || inviteUserIds.length === 0) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Please provide an invite message and at least one user.' },
          });
        }

        const uniqueInviteIds = [...new Set(inviteUserIds)]
          .filter((targetId) => targetId !== userId && !party.members.includes(targetId));

        if (uniqueInviteIds.length === 0) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'No valid invite targets — do not invite yourself or current members.',
            },
          });
        }

        party.invitedUsers = party.invitedUsers || [];
        uniqueInviteIds.forEach((targetId) => {
          if (!party.invitedUsers.includes(targetId)) party.invitedUsers.push(targetId);
        });

        const invitedMentions = uniqueInviteIds.map((id) => `<@${id}>`).join(', ');
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Invited ${invitedMentions} to ${party.partyName}.\nMessage: ${inviteMessage}`,
            allowed_mentions: { parse: [], users: uniqueInviteIds },
            components: [
              {
                type: MessageComponentTypes.ACTION_ROW,
                components: [
                  {
                    type: MessageComponentTypes.BUTTON,
                    custom_id: `accept_invite_${party.partyId}`,
                    label: 'Accept invite',
                    style: ButtonStyleTypes.PRIMARY,
                  },
                ],
              },
            ],
          },
        });
      } else if (subcommand === 'list') {
        const parties = Object.values(activeParties);
        if (!parties.length) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'No active parties right now.' },
          });
        }

        const lines = parties.map((party) => {
          const status = party.members.length >= party.userLimit ? '🟡' : '🟢';
          const queueNote = party.waitlist?.length ? ` *(${party.waitlist.length} queued)*` : '';
          return `${status} **${party.partyName}** — ${party.gameName} — ${party.members.length}/${party.userLimit}${queueNote}`;
        });

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            embeds: [{
              title: 'Active Parties',
              description: lines.join('\n'),
              color: 0x5865f2,
            }],
          },
        });
      } else if (subcommand === 'ign') {
        const gameName = getOption('game_name');
        const ign = getOption('ign');

        if (!gameName || !ign) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Please provide both a game name and an IGN.' },
          });
        }

        try {
          playerManager.addOrUpdate(userId, gameName, ign);

          const partiesToUpdate = Object.values(activeParties).filter(
            (party) => party.gameName === gameName && party.members.includes(userId)
          );

          for (const party of partiesToUpdate) {
            const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
            try {
              await DiscordRequest(updateEndpoint, {
                method: 'PATCH',
                body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
              });
            } catch (patchError) {
              console.error(`Error updating party ${party.partyId}:`, patchError);
            }
          }

          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: `IGN for **${gameName}** set to **${ign}**.` },
          });
        } catch (error) {
          console.error('Error saving IGN:', error);
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'Failed to save your IGN. Please try again.' },
          });
        }
      } else if (subcommand === 'delete') {
        if (!isAdminUser(req)) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You do not have permission to delete parties.' },
          });
        }

        const partyId = getOption('party_id');
        const party = activeParties[partyId];

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: `No party found with ID ${partyId}.` },
          });
        }

        const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
        try {
          await DiscordRequest(updateEndpoint, { method: 'DELETE' });
        } catch (err) {
          console.error(`Error deleting party message for ${partyId}:`, err);
        }

        delete activeParties[partyId];
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: `Deleted party ${party.partyName}.` },
        });
      } else if (subcommand === 'disband') {
        const ownedParties = Object.values(activeParties).filter((party) => party.createdBy === userId);

        if (ownedParties.length === 0) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: InteractionResponseFlags.EPHEMERAL, content: 'You do not own any parties to disband.' },
          });
        }

        for (const party of ownedParties) {
          const updateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
          try {
            await DiscordRequest(updateEndpoint, { method: 'DELETE' });
          } catch (err) {
            console.error(`Error deleting party message for ${party.partyId}:`, err);
          }
          delete activeParties[party.partyId];
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Disbanded ${ownedParties.length} ${ownedParties.length === 1 ? 'party' : 'parties'}.`,
          },
        });
      }
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const componentId = data.custom_id;

    if (componentId.startsWith('join_party_')) {
      const partyId = componentId.replace('join_party_', '');
      const party = activeParties[partyId];

      if (!party) return res.status(400).json({ error: 'party not found' });

      const context = req.body.context;
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      party.bannedUsers = party.bannedUsers || [];
      if (party.bannedUsers.includes(userId)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: `You are banned from ${party.partyName}.` },
        });
      }

      party.waitlist = party.waitlist || [];
      const isMember = party.members.includes(userId);
      const isWaitlisted = party.waitlist.includes(userId);
      let responseMessage;

      if (isMember) {
        responseMessage = `You are already in **${party.partyName}**.`;
      } else if (isWaitlisted) {
        responseMessage = `You are already in the queue at position ${party.waitlist.indexOf(userId) + 1}.`;
      } else if (party.members.length < party.userLimit) {
        party.members.push(userId);
        responseMessage = `You joined **${party.partyName}**!`;
      } else {
        party.waitlist.push(userId);
        responseMessage = `**${party.partyName}** is full — you're in the queue at position ${party.waitlist.length}.`;
      }

      const endpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${req.body.token}/messages/${req.body.message.id}`;
      try {
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: responseMessage },
        });
        await DiscordRequest(endpoint, {
          method: 'PATCH',
          body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
        });
      } catch (err) {
        console.error('Error handling join button:', err);
      }
    } else if (componentId.startsWith('accept_invite_')) {
      const partyId = componentId.replace('accept_invite_', '');
      const party = activeParties[partyId];

      if (!party) return res.status(400).json({ error: 'party not found' });

      const context = req.body.context;
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

      party.bannedUsers = party.bannedUsers || [];
      if (party.bannedUsers.includes(userId)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: `You are banned from ${party.partyName}.` },
        });
      }

      party.waitlist = party.waitlist || [];
      const isMember = party.members.includes(userId);
      const isWaitlisted = party.waitlist.includes(userId);
      let responseMessage;

      if (isMember) {
        responseMessage = `You are already in **${party.partyName}**.`;
      } else if (isWaitlisted) {
        responseMessage = `You are already in the queue at position ${party.waitlist.indexOf(userId) + 1}.`;
      } else if (party.members.length < party.userLimit) {
        party.members.push(userId);
        responseMessage = `You joined **${party.partyName}**!`;
      } else {
        party.waitlist.push(userId);
        responseMessage = `Party is full — you're in the queue at position ${party.waitlist.length}.`;
      }

      const partyUpdateEndpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${party.token}/messages/@original`;
      try {
        await DiscordRequest(partyUpdateEndpoint, {
          method: 'PATCH',
          body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
        });
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: responseMessage },
        });
      } catch (err) {
        console.error('Error handling invite accept:', err);
      }
    } else if (componentId.startsWith('leave_party_')) {
      const partyId = componentId.replace('leave_party_', '');
      const party = activeParties[partyId];

      if (!party) return res.status(400).json({ error: 'party not found' });

      const context = req.body.context;
      const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
      const wasMember = party.members.includes(userId);
      party.waitlist = party.waitlist || [];
      const wasWaitlisted = party.waitlist.includes(userId);

      if (wasMember) party.members = party.members.filter((id) => id !== userId);
      if (wasWaitlisted) party.waitlist = party.waitlist.filter((id) => id !== userId);

      if (wasMember && party.members.length < party.userLimit && party.waitlist.length) {
        const promoted = party.waitlist.shift();
        if (!party.members.includes(promoted)) party.members.push(promoted);
      }

      const endpoint = `webhooks/${process.env.DISCORD_APPLICATION_ID}/${req.body.token}/messages/${req.body.message.id}`;
      const wasLastMember = wasMember && party.members.length === 0;
      const responseMessage = wasMember
        ? wasLastMember
          ? `You left **${party.partyName}**. Party closed — no members remain.`
          : `You left **${party.partyName}**.`
        : wasWaitlisted
          ? `You left the queue for **${party.partyName}**.`
          : `You are not in **${party.partyName}**.`;

      try {
        await res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: InteractionResponseFlags.EPHEMERAL, content: responseMessage },
        });

        if (wasLastMember) {
          delete activeParties[partyId];
          await DiscordRequest(endpoint, { method: 'DELETE' });
        } else {
          await DiscordRequest(endpoint, {
            method: 'PATCH',
            body: { embeds: [buildPartyEmbed(party)], components: buildPartyComponents(party) },
          });
        }
      } catch (err) {
        console.error('Error handling leave button:', err);
      }
    }

    return;
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
