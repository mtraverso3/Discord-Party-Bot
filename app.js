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
import { getRandomEmoji, DiscordRequest } from './utils.js';
import PlayerManager from './ignmanager.js';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of active parties
const activeParties = {};
const playerManager = new PlayerManager();

function isAdminUser(req) {
  const adminUserId = process.env.ADMIN_USER_ID;
  const hasAdminBit = req.body.member?.permissions
    ? (BigInt(req.body.member.permissions) & 0x8n) === 0x8n
    : false;

  return hasAdminBit || (adminUserId && req.body.user?.id === adminUserId);
}

function renderPartyMessage(party) {
  const countText = `${party.members.length}/${party.userLimit}`;
  const memberList = party.members.length
    ? party.members
      .map((memberId) => {
        const ign = playerManager.get(memberId, party.gameName);
        return ign ? `<@${memberId}> (${ign})` : `<@${memberId}>`;
      })
      .join(', ')
    : 'No members yet';
  const waitlistText = party.waitlist && party.waitlist.length
    ? party.waitlist
      .map((memberId) => {
        const ign = playerManager.get(memberId, party.gameName);
        return ign ? `<@${memberId}> (${ign})` : `<@${memberId}>`;
      })
      .join(', ')
    : 'No waitlist';

  return `Party: ${party.partyName}\nMembers: ${countText}\n${memberList}\nVC Link: <#${party.vcLink}>\nGame: ${party.gameName}\nWaitlist: ${waitlistText}`;
}

function createPartyComponents(party) {
  return [
    {
      type: MessageComponentTypes.TEXT_DISPLAY,
      content: renderPartyMessage(party),
    },
    {
      type: MessageComponentTypes.ACTION_ROW,
      components: [
        {
          type: MessageComponentTypes.BUTTON,
          custom_id: `join_party_${party.partyId}`,
          label: `Join party (${party.members.length}/${party.userLimit})`,
          style: ButtonStyleTypes.SECONDARY,
        },
        {
          type: MessageComponentTypes.BUTTON,
          custom_id: `leave_party_${party.partyId}`,
          label: 'Leave party',
          style: ButtonStyleTypes.DANGER,
        },
      ],
    },
  ];
}
/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              // Fetches a random emoji to send from a helper function
              content: `Yeah I'm here`
            }
          ]
        },
      });
    }

    
    
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
        const gameName = getOption('game_name') || 'No game specified';

        activeParties[id] = {
          partyId: id,
          partyName,
          userLimit,
          vcLink,
          gameName,
          members: [userId],
          waitlist: [],
          createdBy: userId,
          token: req.body.token,
        };

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: createPartyComponents(activeParties[id]),
          }
        });
      } else if (subcommand === 'add') {
        const targetUserId = getOption('user');
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You do not have a party to add members to.',
            },
          });
        }

        if (!targetUserId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please select a user to add.',
            },
          });
        }

        if (!party.members.includes(targetUserId)) {
          party.members.push(targetUserId);
        }

        const countText = `${party.members.length}/${party.userLimit}`;
        const memberList = party.members.map((memberId) => `<@${memberId}>`).join(', ');
        const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;

        try {
          await DiscordRequest(updateEndpoint, {
            method: 'PATCH',
            body: {
              components: createPartyComponents(party),
            },
          });
        } catch (err) {
          console.error('Error updating party message after add:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Added <@${targetUserId}> to ${party.partyName}. Current members: ${party.members.length}/${party.userLimit}`,
          },
        });
      } else if (subcommand === 'remove') {
        const targetUserId = getOption('user');
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You do not have a party to remove members from.',
            },
          });
        }

        if (!targetUserId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please select a user to remove.',
            },
          });
        }

        party.members = party.members.filter((memberId) => memberId !== targetUserId);
        party.waitlist = party.waitlist || [];
        if (party.members.length < party.userLimit && party.waitlist.length) {
          const promotedUser = party.waitlist.shift();
          if (!party.members.includes(promotedUser)) {
            party.members.push(promotedUser);
          }
        }

        const countText = `${party.members.length}/${party.userLimit}`;
        const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;

        try {
          if (party.members.length === 0) {
            delete activeParties[party.partyId];
            await DiscordRequest(updateEndpoint, { method: 'DELETE' });
          } else {
            await DiscordRequest(updateEndpoint, {
              method: 'PATCH',
              body: {
                components: createPartyComponents(party),
              },
            });
          }
        } catch (err) {
          console.error('Error updating party message after remove:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Removed <@${targetUserId}> from ${party.partyName}. Current members: ${party.members.length}/${party.userLimit}`,
          },
        });
      } else if (subcommand === 'ban') {
        const targetUserId = getOption('user');
        const party = Object.values(activeParties).find((party) => party.createdBy === userId);

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You do not have a party to ban users from.',
            },
          });
        }

        if (!targetUserId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please select a user to ban.',
            },
          });
        }

        if (targetUserId === userId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You cannot ban yourself.',
            },
          });
        }

        party.bannedUsers = party.bannedUsers || [];
        if (!party.bannedUsers.includes(targetUserId)) {
          party.bannedUsers.push(targetUserId);
        }

        party.members = party.members.filter((memberId) => memberId !== targetUserId);
        party.waitlist = party.waitlist || [];
        party.waitlist = party.waitlist.filter((memberId) => memberId !== targetUserId);

        if (party.members.length < party.userLimit && party.waitlist.length) {
          const promotedUser = party.waitlist.shift();
          if (!party.members.includes(promotedUser)) {
            party.members.push(promotedUser);
          }
        }

        const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;

        try {
          if (party.members.length === 0) {
            delete activeParties[party.partyId];
            await DiscordRequest(updateEndpoint, { method: 'DELETE' });
          } else {
            await DiscordRequest(updateEndpoint, {
              method: 'PATCH',
              body: {
                components: createPartyComponents(party),
              },
            });
          }
        } catch (err) {
          console.error('Error updating party message after ban:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Banned <@${targetUserId}> from ${party.partyName}.`,
          },
        });
      } else if (subcommand === 'changevc') {
        const newVcChannel = getOption('voice_channel');
        const party = Object.values(activeParties).find((party) => party.members.includes(userId));

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You are not in a party to change the voice channel for.',
            },
          });
        }

        if (!newVcChannel) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please select a voice channel.',
            },
          });
        }

        party.vcLink = newVcChannel;

        const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;

        try {
          await DiscordRequest(updateEndpoint, {
            method: 'PATCH',
            body: {
              components: createPartyComponents(party),
            },
          });
        } catch (err) {
          console.error('Error updating party message after changevc:', err);
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Changed voice channel to <#${newVcChannel}>.`,
          },
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
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You do not have a party to invite users to.',
            },
          });
        }

        if (!inviteMessage) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please provide an invite message.',
            },
          });
        }

        if (inviteUserIds.length === 0) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please select at least one user to invite.',
            },
          });
        }

        const uniqueInviteIds = [...new Set(inviteUserIds)]
          .filter((targetId) => targetId !== userId && !party.members.includes(targetId));

        if (uniqueInviteIds.length === 0) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'No valid invite targets were selected. Make sure you are not inviting yourself or users who are already in the party.',
            },
          });
        }

        party.invitedUsers = party.invitedUsers || [];
        uniqueInviteIds.forEach((targetId) => {
          if (!party.invitedUsers.includes(targetId)) {
            party.invitedUsers.push(targetId);
          }
        });

        const invitedMentions = uniqueInviteIds.map((id) => `<@${id}>`).join(', ');

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Invited ${invitedMentions} to ${party.partyName}.\nMessage: ${inviteMessage}`,
            allowed_mentions: {
              parse: [],
              users: uniqueInviteIds,
            },
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
        const responseText = parties.length
          ? parties.map((party) => `• ${party.partyName} — ID: ${party.partyId}`).join('\n')
          : 'There are no active parties right now.';

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: responseText,
          },
        });
      } else if (subcommand === 'ign') {
        const gameName = getOption('game_name');
        const ign = getOption('ign');

        if (!gameName || !ign) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Please provide both a game name and an IGN.',
            },
          });
        }

        try {
          playerManager.addOrUpdate(userId, gameName, ign);

          const partiesToUpdate = Object.values(activeParties).filter(
            (party) => party.gameName === gameName && party.members.includes(userId)
          );

          for (const party of partiesToUpdate) {
            const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;
            try {
              await DiscordRequest(updateEndpoint, {
                method: 'PATCH',
                body: {
                  components: createPartyComponents(party),
                },
              });
            } catch (patchError) {
              console.error(`Error updating party message for ${party.partyId}:`, patchError);
            }
          }

          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: `Saved your IGN for ${gameName}: ${ign}`,
            },
          });
        } catch (error) {
          console.error('Error saving IGN:', error);
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'Failed to save your IGN. Please try again.',
            },
          });
        }
      } else if (subcommand === 'delete') {
        if (!isAdminUser(req)) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You do not have permission to delete parties.',
            },
          });
        }

        const partyId = getOption('party_id');
        const party = activeParties[partyId];

        if (!party) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: `No party found with ID ${partyId}.`,
            },
          });
        }

        const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;
        try {
          await DiscordRequest(updateEndpoint, { method: 'DELETE' });
        } catch (err) {
          console.error(`Error deleting party message for ${partyId}:`, err);
        }

        delete activeParties[partyId];

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Deleted party ${party.partyName} (ID: ${partyId}).`,
          },
        });
      } else if (subcommand === 'disband') {
        const ownedParties = Object.values(activeParties).filter((party) => party.createdBy === userId);

        if (ownedParties.length === 0) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: InteractionResponseFlags.EPHEMERAL,
              content: 'You do not own any parties to disband.',
            },
          });
        }

        let disbandCount = 0;
        for (const party of ownedParties) {
          const updateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;
          try {
            await DiscordRequest(updateEndpoint, { method: 'DELETE' });
          } catch (err) {
            console.error(`Error deleting party message for ${party.partyId}:`, err);
          }
          delete activeParties[party.partyId];
          disbandCount += 1;
        }

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.EPHEMERAL,
            content: `Disbanded ${disbandCount} ${disbandCount === 1 ? 'party' : 'parties'} that you created.`,
          },
        });
      }
    }
    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }
  if (type === InteractionType.MESSAGE_COMPONENT) {
      // custom_id set in payload when sending message component
      const componentId = data.custom_id;

      if (componentId.startsWith('accept_button_')) {
        // get the associated game ID
        const gameId = componentId.replace('accept_button_', '');
        // Delete message with token in request body
        const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
        try {
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              // Indicates it'll be an ephemeral message
              flags: InteractionResponseFlags.EPHEMERAL | InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: 'What is your object of choice?',
                },
                {
                  type: MessageComponentTypes.ACTION_ROW,
                  components: [
                    {
                      type: MessageComponentTypes.STRING_SELECT,
                      // Append game ID
                      custom_id: `select_choice_${gameId}`,
                      options: getShuffledOptions(),
                    },
                  ],
                },
              ],
            },
          });
          // Delete previous message
          await DiscordRequest(endpoint, { method: 'DELETE' });
        } catch (err) {
          console.error('Error sending message:', err);
        }
      } else if (componentId.startsWith('join_party_')) {
        const partyId = componentId.replace('join_party_', '');
        const party = activeParties[partyId];

        if (party) {
          const context = req.body.context;
          const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

          party.bannedUsers = party.bannedUsers || [];
          if (party.bannedUsers.includes(userId)) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: `You are banned from ${party.partyName}.`,
              },
            });
          }

          party.waitlist = party.waitlist || [];
          const isMember = party.members.includes(userId);
          const isWaitlisted = party.waitlist.includes(userId);
          let responseMessage;

          if (isMember) {
            responseMessage = `You are already a member of ${party.partyName}.`;
          } else if (isWaitlisted) {
            const position = party.waitlist.indexOf(userId) + 1;
            responseMessage = `You are already on the waitlist for ${party.partyName} at position ${position}.`;
          } else if (party.members.length < party.userLimit) {
            party.members.push(userId);
            responseMessage = `You joined ${party.partyName}! ${party.members.length}/${party.userLimit}`;
          } else {
            party.waitlist.push(userId);
            const position = party.waitlist.length;
            responseMessage = `The party is full. You've been added to the waitlist at position ${position}.`;
          }

          const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;

          try {
            await res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: responseMessage,
              },
            });

            await DiscordRequest(endpoint, {
              method: 'PATCH',
              body: {
                components: createPartyComponents(party),
              },
            });
          } catch (err) {
            console.error('Error handling join button:', err);
          }
        } else {
          return res.status(400).json({ error: 'party not found' });
        }
      } else if (componentId.startsWith('accept_invite_')) {
        const partyId = componentId.replace('accept_invite_', '');
        const party = activeParties[partyId];

        if (party) {
          const context = req.body.context;
          const userId = context === 0 ? req.body.member.user.id : req.body.user.id;

          party.bannedUsers = party.bannedUsers || [];
          if (party.bannedUsers.includes(userId)) {
            return res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: `You are banned from ${party.partyName}.`,
              },
            });
          }

          party.waitlist = party.waitlist || [];
          const isMember = party.members.includes(userId);
          const isWaitlisted = party.waitlist.includes(userId);
          let responseMessage;

          if (isMember) {
            responseMessage = `You are already a member of ${party.partyName}.`;
          } else if (isWaitlisted) {
            const position = party.waitlist.indexOf(userId) + 1;
            responseMessage = `You are already on the waitlist for ${party.partyName} at position ${position}.`;
          } else if (party.members.length < party.userLimit) {
            party.members.push(userId);
            responseMessage = `You joined ${party.partyName}! ${party.members.length}/${party.userLimit}`;
          } else {
            party.waitlist.push(userId);
            const position = party.waitlist.length;
            responseMessage = `The party is full. You've been added to the waitlist at position ${position}.`;
          }

          const countText = `${party.members.length}/${party.userLimit}`;
          const inviteMessageEndpoint = `channels/${req.body.channel_id}/messages/${req.body.message.id}`;
          const partyUpdateEndpoint = `webhooks/${process.env.APP_ID}/${party.token}/messages/@original`;

          try {
            await DiscordRequest(partyUpdateEndpoint, {
              method: 'PATCH',
              body: {
                components: createPartyComponents(party),
              },
            });

            // await DiscordRequest(inviteMessageEndpoint, {
            //   method: 'PATCH',
            //   body: {
            //     components: [
            //       {
            //         type: MessageComponentTypes.TEXT_DISPLAY,
            //         content: `Accepted invite to ${party.partyName}.`,
            //       },
            //     ],
            //   },
            // });

            await res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: responseMessage,
              },
            });
          } catch (err) {
            console.error('Error handling invite accept button:', err);
          }
        } else {
          return res.status(400).json({ error: 'party not found' });
        }
      } else if (componentId.startsWith('leave_party_')) {
        const partyId = componentId.replace('leave_party_', '');
        const party = activeParties[partyId];

        if (party) {
          const context = req.body.context;
          const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
          const wasMember = party.members.includes(userId);
          party.waitlist = party.waitlist || [];
          const wasWaitlisted = party.waitlist.includes(userId);

          if (wasMember) {
            party.members = party.members.filter((memberId) => memberId !== userId);
          }

          if (wasWaitlisted) {
            party.waitlist = party.waitlist.filter((memberId) => memberId !== userId);
          }

          if (wasMember && party.members.length < party.userLimit && party.waitlist.length) {
            const promotedUser = party.waitlist.shift();
            if (!party.members.includes(promotedUser)) {
              party.members.push(promotedUser);
            }
          }

          const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;
          const wasLastMember = wasMember && party.members.length === 0;
          const responseMessage = wasMember
            ? wasLastMember
              ? `You left ${party.partyName}. The party has been closed because no members remain.`
              : `You left ${party.partyName}. ${party.members.length}/${party.userLimit}`
            : wasWaitlisted
              ? `You were removed from the waitlist for ${party.partyName}.`
              : `You are not in ${party.partyName}.`;

          try {
            await res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                flags: InteractionResponseFlags.EPHEMERAL,
                content: responseMessage,
              },
            });

            if (wasLastMember) {
              delete activeParties[partyId];
              await DiscordRequest(endpoint, { method: 'DELETE' });
            } else {
              await DiscordRequest(endpoint, {
                method: 'PATCH',
                body: {
                  components: createPartyComponents(party),
                },
              });
            }
          } catch (err) {
            console.error('Error handling leave button:', err);
          }
        } else {
          return res.status(400).json({ error: 'party not found' });
        }
      } else if (componentId.startsWith('select_choice_')) {
        // get the associated game ID
        const gameId = componentId.replace('select_choice_', '');

        if (activeGames[gameId]) {
          // Interaction context
          const context = req.body.context;
          // Get user ID and object choice for responding user
          // User ID is in user field for (G)DMs, and member for servers
          const userId = context === 0 ? req.body.member.user.id : req.body.user.id;
          const objectName = data.values[0];
          // Calculate result from helper function
          const resultStr = getResult(activeGames[gameId], {
            id: userId,
            objectName,
          });

          // Remove game from storage
          delete activeGames[gameId];
          // Update message with token in request body
          const endpoint = `webhooks/${process.env.APP_ID}/${req.body.token}/messages/${req.body.message.id}`;

          try {
            // Send results
            await res.send({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                flags: InteractionResponseFlags.IS_COMPONENTS_V2,
                components: [
                  {
                    type: MessageComponentTypes.TEXT_DISPLAY,
                    content: resultStr
                  }
                ]
                },
            });
            // Update ephemeral message
            await DiscordRequest(endpoint, {
              method: 'PATCH',
              body: {
                components: [
                  {
                    type: MessageComponentTypes.TEXT_DISPLAY,
                    content: 'Nice choice ' + getRandomEmoji()
                  }
                ],
              },
            });
          } catch (err) {
            console.error('Error sending message:', err);
          }
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
