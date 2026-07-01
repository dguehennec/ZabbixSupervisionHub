import { describe, it, expect, beforeEach } from 'vitest';
import { resetChromeMocks, mockSyncStorage } from './setup';
import { Prefs } from '../src/modules/service/Prefs';
import { ZabbixAuthMethod } from '../src/types';

describe('Prefs', () => {
  beforeEach(async () => {
    resetChromeMocks();
    await Prefs.load();
  });

  it('loads defaults on first launch', () => {
    const prefs = Prefs.get();
    expect(prefs.isFirstLaunch).toBe(true);
    expect(prefs.instances).toEqual([]);
    expect(prefs.autoConnect).toBe(false);
  });

  it('adds and retrieves an instance', async () => {
    await Prefs.addInstance({
      id: 'inst-1',
      alias: 'Prod',
      apiUrl: 'https://zabbix.example.com/api_jsonrpc.php',
      webUrl: 'https://zabbix.example.com',
      username: 'Admin',
      passwordEncrypted: '',
      savePassword: false,
      authMethod: ZabbixAuthMethod.PASSWORD,
      apiTokenEncrypted: '',
      saveApiToken: false,
      enabled: true,
    });
    expect(Prefs.getInstances()).toHaveLength(1);
    expect(Prefs.getInstances()[0].alias).toBe('Prod');
  });

  it('persists updates to chrome.storage.sync', async () => {
    await Prefs.update('autoConnect', true);
    expect(Prefs.get().autoConnect).toBe(true);
    expect(mockSyncStorage.set).toHaveBeenCalled();
  });

  it('encrypts saved passwords', async () => {
    await Prefs.addInstance({
      id: 'inst-2',
      alias: 'Test',
      apiUrl: 'http://localhost:3000/api_jsonrpc.php',
      webUrl: 'http://localhost:3000',
      username: 'user',
      passwordEncrypted: '',
      savePassword: true,
      enabled: true,
    });
    await Prefs.savePassword('inst-2', 'password123');
    const loaded = await Prefs.loadPassword('inst-2');
    expect(loaded).toBe('password123');
  });

  it('encrypts saved API tokens', async () => {
    await Prefs.addInstance({
      id: 'inst-3',
      alias: 'Token',
      apiUrl: 'http://localhost:3000/api_jsonrpc.php',
      webUrl: 'http://localhost:3000',
      username: '',
      passwordEncrypted: '',
      savePassword: false,
      authMethod: ZabbixAuthMethod.API_TOKEN,
      apiTokenEncrypted: '',
      saveApiToken: true,
      enabled: true,
    });
    await Prefs.saveApiToken('inst-3', 'my-secret-token');
    const loaded = await Prefs.loadApiToken('inst-3');
    expect(loaded).toBe('my-secret-token');
  });
});
