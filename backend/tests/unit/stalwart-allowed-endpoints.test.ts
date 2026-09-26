import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StalwartClient } from '../../src/stalwart/client';
import { StalwartError } from '../../src/stalwart/errors';

describe('Unit Tests: Stalwart allowedEndpoints Access Control (Gap 1)', () => {
  let client: StalwartClient;

  beforeEach(() => {
    client = new StalwartClient();
  });

  it('should dispatch x:Http/get and return allowedEndpoints configuration', async () => {
    const mockEndpointsConfig = {
      match: [
        {
          if: "listener == 'private-http' || contains(['jmap', 'robots.txt', '.well-known'], split(path, '/')[1])",
          then: '200',
        },
      ],
      else: '404',
    };

    // Spy on internal dispatch
    const dispatchSpy = vi.spyOn(client as any, 'dispatch').mockResolvedValue([
      [
        'x:Http/get',
        {
          list: [
            {
              id: 'singleton',
              allowedEndpoints: mockEndpointsConfig,
            },
          ],
        },
        'c_get_http',
      ],
    ]);

    const result = await client.getAllowedEndpoints();
    expect(dispatchSpy).toHaveBeenCalledWith([
      ['x:Http/get', { accountId: 'b', ids: null }, 'c_get_http'],
    ]);
    expect(result).toEqual(mockEndpointsConfig);
  });

  it('should dispatch x:Http/set with verified "path" variable (not "url_path")', async () => {
    const dispatchSpy = vi.spyOn(client as any, 'dispatch').mockResolvedValue([
      [
        'x:Http/set',
        {
          updated: {
            singleton: {},
          },
        },
        'c_set_http',
      ],
    ]);

    await client.configureAllowedEndpoints();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const calledArgs = dispatchSpy.mock.calls[0][0];
    expect(calledArgs[0][0]).toBe('x:Http/set');

    const updatePayload = calledArgs[0][1].update.singleton.allowedEndpoints;
    expect(updatePayload.else).toBe('404');
    expect(updatePayload.match[0].then).toBe('200');

    // CRITICAL: Ensure verified variable 'path' is used, NEVER 'url_path'
    const ifExpression = updatePayload.match[0].if;
    expect(ifExpression).toContain('split(path,');
    expect(ifExpression).not.toContain('url_path');
    expect(ifExpression).toContain("listener == 'private-http'");
  });

  it('should throw StalwartError when x:Http/set fails', async () => {
    vi.spyOn(client as any, 'dispatch').mockResolvedValue([
      [
        'x:Http/set',
        {
          notUpdated: {
            singleton: {
              type: 'invalidProperties',
              description: 'Expression syntax error',
            },
          },
        },
        'c_set_http',
      ],
    ]);

    await expect(client.configureAllowedEndpoints()).rejects.toThrow(StalwartError);
    await expect(client.configureAllowedEndpoints()).rejects.toThrow(
      /Failed to set allowedEndpoints in Stalwart/
    );
  });
});
