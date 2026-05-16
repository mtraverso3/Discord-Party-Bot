import 'dotenv/config';
import { capitalize, InstallGlobalCommands } from './utils.js';

const GAMES = [
            { name: 'LoL NA', value: 'LoL NA' },
            { name: 'LoL PBE', value: 'LoL PBE' },
            { name: 'Starcraft 2', value: 'Starcraft 2' },
            { name: 'Valorant', value: 'Valorant' },
            { name: 'CS2', value: 'CS2' },
            { name: 'Overwatch 2', value: 'Overwatch 2' },
            { name: 'Rocket League', value: 'Rocket League' },
            { name: 'Goose Goose Duck', value: 'Goose Goose Duck' },
            { name: 'Other', value: 'Other' },
          ]

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};



// create party command with text inputs for name, user limit, vc link, and game name
const PARTY_COMMAND = {
  name: 'party',
  description: 'Party management',
  options: [
    {
      type: 1,
      name: 'create',
      description: 'Create a party',
      options: [
        
        {
          type: 4,
          name: 'user_limit',
          description: 'Enter the maximum number of users',
          required: true,
        },
        {
          type: 7,
          name: 'voice_channel',
          description: 'Enter the voice channel',
          required: true,
        },
        {
          type: 3,
          name: 'name',
          description: 'Enter the party name',
          required: false,
        },
        {
          type: 3,
          name: 'game_name',
          description: 'Enter the game name',
          required: false,
          choices: GAMES,
        },
      ],
    },
    {
      type: 1,
      name: 'add',
      description: 'Add a user to your party',
      options: [
        {
          type: 6,
          name: 'user',
          description: 'User ID to add',
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: 'remove',
      description: 'Remove a user from your party',
      options: [
        {
          type: 6,
          name: 'user',
          description: 'User ID to remove',
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: 'disband',
      description: 'Disband your party if you are the party leader',
    },
    {
      type: 1,
      name: 'ban',
      description: 'Ban a user from your party',
      options: [
        {
          type: 6,
          name: 'user',
          description: 'User to ban from the party',
          required: true,
        },
      ],
    },
    {      type: 1,
      name: 'changevc',
      description: 'Change the voice channel for your party',
      options: [
        {
          type: 7,
          name: 'voice_channel',
          description: 'New voice channel',
          required: true,
        },
      ],
    },
    {      type: 1,
      name: 'invite',
      description: 'Invite users to your party',
      options: [
        {
          type: 3,
          name: 'message',
          description: 'Invite message to include',
          required: true,
        },
        {
          type: 6,
          name: 'user1',
          description: 'First user to invite',
          required: true,
        },
        {
          type: 6,
          name: 'user2',
          description: 'Second user to invite',
          required: false,
        },
        {
          type: 6,
          name: 'user3',
          description: 'Third user to invite',
          required: false,
        },
        {
          type: 6,
          name: 'user4',
          description: 'Fourth user to invite',
          required: false,
        },
        {
          type: 6,
          name: 'user5',
          description: 'Fifth user to invite',
          required: false,
        },
        {
          type: 6,
          name: 'user6',
          description: 'Sixth user to invite',
          required: false,
        },
      ],
    },
    {
      type: 1,
      name: 'delete',
      description: 'Admin only: delete a party by party ID',
      options: [
        {
          type: 3,
          name: 'party_id',
          description: 'The ID of the party to delete',
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: 'ign',
      description: 'Save your in-game name for a game',
      options: [
        {
          type: 3,
          name: 'game_name',
          description: 'Name of the game',
          required: true,
          choices: GAMES,
        },
        {
          type: 3,
          name: 'ign',
          description: 'Your in-game name',
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: 'list',
      description: 'List all active parties along with their party IDs',
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
};

//Party command
//options for add/remove/ban user, channel for changing vc link, and invite user


const ALL_COMMANDS = [TEST_COMMAND, PARTY_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
