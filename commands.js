import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

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
];

const PARTY_COMMAND = {
  name: 'party',
  description: 'Party management for inhouse games',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 2],
  options: [
    {
      type: 1,
      name: 'create',
      description: 'Create a party',
      options: [
        { type: 4, name: 'user_limit', description: 'Maximum number of players', required: true },
        { type: 7, name: 'voice_channel', description: 'Voice channel to link', required: true },
        { type: 3, name: 'name', description: 'Party name', required: false },
        { type: 3, name: 'game_name', description: 'Game you are playing', required: false, choices: GAMES },
      ],
    },
    {
      type: 1,
      name: 'add',
      description: 'Add a user to your party',
      options: [{ type: 6, name: 'user', description: 'User to add', required: true }],
    },
    {
      type: 1,
      name: 'remove',
      description: 'Remove a user from your party',
      options: [{ type: 6, name: 'user', description: 'User to remove', required: true }],
    },
    {
      type: 1,
      name: 'disband',
      description: 'Disband your party',
    },
    {
      type: 1,
      name: 'ban',
      description: 'Ban a user from your party',
      options: [{ type: 6, name: 'user', description: 'User to ban', required: true }],
    },
    {
      type: 1,
      name: 'changevc',
      description: 'Change the voice channel for your party',
      options: [{ type: 7, name: 'voice_channel', description: 'New voice channel', required: true }],
    },
    {
      type: 1,
      name: 'invite',
      description: 'Invite users to your party',
      options: [
        { type: 3, name: 'message', description: 'Invite message', required: true },
        { type: 6, name: 'user1', description: 'User to invite', required: true },
        { type: 6, name: 'user2', description: 'User to invite', required: false },
        { type: 6, name: 'user3', description: 'User to invite', required: false },
        { type: 6, name: 'user4', description: 'User to invite', required: false },
        { type: 6, name: 'user5', description: 'User to invite', required: false },
        { type: 6, name: 'user6', description: 'User to invite', required: false },
      ],
    },
    {
      type: 1,
      name: 'delete',
      description: 'Admin only: delete a party by ID',
      options: [{ type: 3, name: 'party_id', description: 'Party ID to delete', required: true }],
    },
    {
      type: 1,
      name: 'ign',
      description: 'Save your in-game name for a game',
      options: [
        { type: 3, name: 'game_name', description: 'Game', required: true, choices: GAMES },
        { type: 3, name: 'ign', description: 'Your in-game name', required: true },
      ],
    },
    {
      type: 1,
      name: 'list',
      description: 'List all active parties in this server',
    },
  ],
};

InstallGlobalCommands(process.env.APP_ID, [PARTY_COMMAND]);
