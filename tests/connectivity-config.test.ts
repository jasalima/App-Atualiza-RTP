import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealCredential, openCredential } from '../server/services/travel-credentials';
import { Evolution } from '../server/services/evolution';
const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../lib/db',()=>({sql:query}));
import { connectivityConfig, saveConnectivity } from '../lib/connectivity-config';
beforeEach(()=>{query.mockReset();vi.stubEnv('WHATSAPP_CREDENTIAL_SECRET','test-secret-with-at-least-32-characters');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('project connectivity configuration',()=>{
  it('loads the project credential without exposing or sharing another scope',async()=>{
    query.mockResolvedValue([{evolution_url:'https://project.example',encrypted_api_key:sealCredential('project-key','connectivity:project-a')}]);
    expect(await connectivityConfig('project-a')).toEqual({url:'https://project.example',key:'project-key',source:'project'});
    expect(query.mock.calls[0].slice(1)).toEqual(['project-a']);
  });
  it('uses environment settings only when no project-specific settings exist',async()=>{
    query.mockResolvedValue([]);vi.stubEnv('EVOLUTION_API_URL','https://server.example');vi.stubEnv('EVOLUTION_API_KEY','environment-key');
    expect(await connectivityConfig('project-a')).toMatchObject({key:'environment-key',source:'environment'});
  });
  it('reports an environment secret mismatch instead of silently using another server',async()=>{
    query.mockResolvedValue([{evolution_url:'https://project.example',encrypted_api_key:sealCredential('project-key','connectivity:another-project')}]);
    vi.stubEnv('EVOLUTION_API_KEY','unrelated-fallback');
    await expect(connectivityConfig('project-a')).rejects.toMatchObject({code:'CONFIG_KEY_UNREADABLE'});
  });
  it('validates provider authentication before storing an encrypted, scope-bound key',async()=>{
    const check=vi.spyOn(Evolution.prototype,'checkCredentials').mockResolvedValue(undefined);
    query.mockResolvedValue([]);
    await saveConnectivity('project-a','manager','https://server.example','master-secret');
    expect(check).toHaveBeenCalledTimes(1);
    const values=query.mock.calls[0].slice(1);
    expect(values).toEqual(['project-a','https://server.example',expect.any(String),'manager']);
    expect(values[2]).not.toContain('master-secret');
    expect(openCredential(values[2],'connectivity:project-a')).toBe('master-secret');
    expect(()=>openCredential(values[2],'connectivity:another-project')).toThrow();
  });
  it('keeps the previous configuration when provider authentication fails',async()=>{
    vi.spyOn(Evolution.prototype,'checkCredentials').mockRejectedValue(new Error('Unauthorized'));
    await expect(saveConnectivity('project-a','manager','https://server.example','invalid-key')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
