import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../bot/command-parser.js';
import { Command } from '../core/commands.js';

test('parses common commands', () => {
  assert.equal(parseCommand('Hi').command, Command.START);
  assert.equal(parseCommand('1').command, Command.ROLE_LANDLORD);
  assert.equal(parseCommand('2').command, Command.ROLE_TENANT);
  assert.equal(parseCommand('ADD PROPERTY').command, Command.ADD_PROPERTY);
  assert.equal(parseCommand('BALANCE').command, Command.BALANCE);
});

test('parses buy amount', () => {
  const parsed = parseCommand('BUY 2000');
  assert.equal(parsed.command, Command.BUY);
  assert.equal(parsed.args.amountNaira, 2000);
});

test('parses tenant registration property code', () => {
  const parsed = parseCommand('REGISTER GRD-LAG-0001');
  assert.equal(parsed.command, Command.REGISTER);
  assert.equal(parsed.args.propertyCode, 'GRD-LAG-0001');
});
