import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRowsPaginated } from './migrateToSupabase.ts';

test('Pagination: handles empty table', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-range' ? '*/0' : null),
      },
      json: async () => [],
    } as any;
  };

  try {
    const res = await fetchAllRowsPaginated('http://mock.supabase', 'recharge_plans', {});
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.rows.length, 0);
      assert.equal(res.totalDeclared, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pagination: handles over 1000 rows across pages', async () => {
  const originalFetch = globalThis.fetch;
  const TOTAL_MOCK_ROWS = 1250;
  const PAGE_SIZE = 500;

  globalThis.fetch = async (url: any, opts: any) => {
    const rangeHeader = opts.headers['Range'];
    const [startStr, endStr] = rangeHeader.split('-');
    const start = parseInt(startStr, 10);
    const end = Math.min(parseInt(endStr, 10), TOTAL_MOCK_ROWS - 1);

    const rows = [];
    for (let i = start; i <= end; i++) {
      rows.push({ id: `item-${i}` });
    }

    return {
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-range' ? `${start}-${end}/${TOTAL_MOCK_ROWS}` : null),
      },
      json: async () => rows,
    } as any;
  };

  try {
    const res = await fetchAllRowsPaginated('http://mock.supabase', 'recharge_orders', {});
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.rows.length, 1250);
      assert.equal(res.totalDeclared, 1250);
      assert.equal(res.rows[0].id, 'item-0');
      assert.equal(res.rows[1249].id, 'item-1249');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pagination: fails cleanly on HTTP error response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any;
  };

  try {
    const res = await fetchAllRowsPaginated('http://mock.supabase', 'admin_users', {});
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /HTTP 500/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pagination: fails cleanly on missing content-range header', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      headers: {
        get: () => null,
      },
      json: async () => [],
    } as any;
  };

  try {
    const res = await fetchAllRowsPaginated('http://mock.supabase', 'website_settings', {});
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /Missing content-range header/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
