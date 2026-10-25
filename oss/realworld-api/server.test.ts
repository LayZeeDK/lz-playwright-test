import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { createApiServer } from './server.ts';

async function start(stateFile?: string): Promise<{ server: Server; base: string }> {
  const server = createApiServer({ stateFile });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  return { server, base: `http://localhost:${(server.address() as AddressInfo).port}/api` };
}

const stop = (server: Server) => new Promise((resolve) => server.close(resolve));

interface Call {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

function client(base: string) {
  return async (path: string, { method = 'GET', body, token, headers = {} }: Call = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Token ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
  };
}

describe('realworld api double', async () => {
  const { server, base } = await start();
  const api = client(base);

  after(() => stop(server));

  let token = '';
  let slug = '';
  const name = `user${Date.now()}`;

  test('register, duplicate registration is 422', async () => {
    const user = { username: name, email: `${name}@example.com`, password: name };
    const res = await api('/users', { method: 'POST', body: { user } });

    assert.equal(res.status, 201);
    assert.equal(res.json.user.username, name);
    assert.match(res.json.user.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.match(res.headers.get('set-cookie') ?? '', /^jwt=/);

    const dup = await api('/users', { method: 'POST', body: { user } });

    assert.equal(dup.status, 422);
    assert.deepEqual(dup.json.errors.email, ['has already been taken']);
    assert.deepEqual(dup.json.errors.username, ['has already been taken']);

    const empty = await api('/users', { method: 'POST', body: { user: {} } });

    assert.equal(empty.status, 422);
    assert.deepEqual(empty.json.errors.password, ["can't be blank"]);
  });

  test('login, wrong password is 422 "User not found"', async () => {
    const res = await api('/users/login', {
      method: 'POST',
      body: { user: { email: `${name}@example.com`, password: name } },
    });

    assert.equal(res.status, 200);
    token = res.json.user.token;

    const bad = await api('/users/login', {
      method: 'POST',
      body: { user: { email: `${name}@example.com`, password: '111111111' } },
    });

    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json, { errors: { message: ['User not found'] } });
  });

  test('current user: token header and jwt cookie both work, none is 401', async () => {
    const res = await api('/user', { token });

    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, `${name}@example.com`);

    const viaCookie = await api('/user', { headers: { Cookie: `jwt=${token}` } });

    assert.equal(viaCookie.status, 200);
    assert.equal((await api('/user')).status, 401);
    assert.equal((await api('/user', { token: `${token}x` })).status, 401);
  });

  test('update user', async () => {
    const res = await api('/user', {
      method: 'PUT',
      token,
      body: { user: { bio: 'hello', image: 'http://img/x.png', password: 'newpass' } },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.user.bio, 'hello');
    assert.equal(res.json.user.image, 'http://img/x.png');

    const relogin = await api('/users/login', {
      method: 'POST',
      body: { user: { email: `${name}@example.com`, password: 'newpass' } },
    });

    assert.equal(relogin.status, 200);

    const clash = await api('/user', { method: 'PUT', token, body: { user: { email: 'jake@example.com' } } });

    assert.equal(clash.status, 422);
    assert.equal((await api('/user', { method: 'PUT', body: { user: {} } })).status, 401);
  });

  test('list articles, filters, pagination and tags (anonymous)', async () => {
    const all = await api('/articles?limit=10&offset=0');

    assert.equal(all.status, 200);
    assert.equal(all.json.articlesCount, 5);
    assert.equal(all.json.articles.length, 5);
    assert.equal(all.json.articles[0].title, 'Nx workspaces');
    assert.equal(all.json.articles[0].favorited, false);

    assert.equal((await api('/articles?limit=2&offset=4')).json.articles.length, 1);
    assert.equal((await api('/articles?tag=testing')).json.articlesCount, 2);
    assert.equal((await api('/articles?author=jake')).json.articlesCount, 2);
    assert.equal((await api('/articles?favorited=anne')).json.articlesCount, 1);
    assert.equal((await api('/articles?limit=abc&offset=x')).json.articles.length, 5);
    assert.equal((await api('/articles/%E0%A4%A')).status, 404);

    const tags = await api('/tags');

    assert.equal(tags.status, 200);
    assert.ok(tags.json.tags.includes('testing'));
  });

  test('feed needs a token and lists followed authors only', async () => {
    assert.equal((await api('/articles/feed')).status, 401);
    assert.equal((await api('/articles/feed', { token })).json.articlesCount, 0);

    const anne = (await api('/users/login', { method: 'POST', body: { user: { email: 'anne@example.com', password: 'password123' } } })).json.user.token;
    const feed = await api('/articles/feed', { token: anne });

    assert.equal(feed.json.articlesCount, 2);
    assert.ok(feed.json.articles.every((a: { author: { username: string } }) => a.author.username === 'jake'));
  });

  test('create, get, update, delete article', async () => {
    const body = { article: { title: 'E2E Test Article', description: 'desc', body: 'text', tagList: ['e2e', ' testing', ' playwright'] } };

    assert.equal((await api('/articles', { method: 'POST', body })).status, 401);
    assert.equal((await api('/articles/', { method: 'POST', token, body: { article: { title: 'x' } } })).status, 422);

    const created = await api('/articles/', { method: 'POST', token, body });

    assert.equal(created.status, 201);
    slug = created.json.article.slug;
    assert.equal(slug, 'e2e-test-article');
    assert.deepEqual(created.json.article.tagList, ['e2e', 'testing', 'playwright']);
    assert.equal(created.json.article.author.username, name);

    const got = await api(`/articles/${slug}`);

    assert.equal(got.json.article.title, 'E2E Test Article');
    assert.equal((await api('/articles/nope')).status, 404);

    const updated = await api(`/articles/${slug}`, { method: 'PUT', token, body: { article: { title: 'Renamed', body: 'new body' } } });

    assert.equal(updated.status, 200);
    assert.equal(updated.json.article.slug, 'renamed');
    assert.equal(updated.json.article.body, 'new body');
    assert.equal(updated.json.article.description, 'desc');
    slug = updated.json.article.slug;

    const other = await api(`/articles/how-to-train-your-dragon`, { method: 'PUT', token, body: { article: { title: 'Hijack' } } });

    assert.equal(other.status, 403);

    assert.equal((await api(`/articles/${slug}`, { method: 'DELETE', token })).status, 204);
    assert.equal((await api(`/articles/${slug}`)).status, 404);
    assert.equal((await api('/articles/how-to-train-your-dragon', { method: 'DELETE', token })).status, 403);
  });

  test('favorite and unfavorite', async () => {
    const fav = await api('/articles/nx-workspaces/favorite', { method: 'POST', token });

    assert.equal(fav.status, 200);
    assert.equal(fav.json.article.favorited, true);
    assert.equal(fav.json.article.favoritesCount, 1);
    assert.equal((await api('/articles?favorited=' + name)).json.articlesCount, 1);
    assert.equal((await api('/articles/nx-workspaces/favorite', { method: 'POST' })).status, 401);

    const unfav = await api('/articles/nx-workspaces/favorite', { method: 'DELETE', token });

    assert.equal(unfav.json.article.favorited, false);
    assert.equal(unfav.json.article.favoritesCount, 0);
  });

  test('comments: list, add, delete', async () => {
    const path = '/articles/how-to-train-your-dragon/comments';
    const list = await api(path);

    assert.equal(list.json.comments.length, 1);
    assert.equal(list.json.comments[0].author.username, 'anne');

    assert.equal((await api(path, { method: 'POST', body: { comment: { body: 'hi' } } })).status, 401);
    assert.equal((await api(path, { method: 'POST', token, body: { comment: {} } })).status, 422);

    const added = await api(path, { method: 'POST', token, body: { comment: { body: 'First!' } } });

    assert.equal(added.status, 201);
    assert.equal(added.json.comment.body, 'First!');
    assert.equal(typeof added.json.comment.id, 'number');
    assert.equal((await api(path)).json.comments[0].id, added.json.comment.id);

    assert.equal((await api(`${path}/${list.json.comments[0].id}`, { method: 'DELETE', token })).status, 403);
    assert.equal((await api(`${path}/${added.json.comment.id}`, { method: 'DELETE', token })).status, 204);
    assert.equal((await api(`${path}/${added.json.comment.id}`, { method: 'DELETE', token })).status, 404);
    assert.equal((await api(path)).json.comments.length, 1);
  });

  test('profile, follow and unfollow', async () => {
    const anon = await api('/profiles/jake');

    assert.equal(anon.status, 200);
    assert.equal(anon.json.profile.username, 'jake');
    assert.equal(anon.json.profile.following, false);
    assert.equal((await api('/profiles/nobody')).status, 404);

    const follow = await api('/profiles/jake/follow', { method: 'POST', token });

    assert.equal(follow.json.profile.following, true);
    assert.equal((await api('/profiles/jake', { token })).json.profile.following, true);
    assert.equal((await api('/articles/feed', { token })).json.articlesCount, 2);
    assert.equal((await api('/profiles/jake/follow', { method: 'POST' })).status, 401);

    const unfollow = await api('/profiles/jake/follow', { method: 'DELETE', token });

    assert.equal(unfollow.json.profile.following, false);
  });

  test('logout clears the cookie; CORS preflight and headers', async () => {
    const out = await api('/users/logout', { method: 'POST', token });

    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie') ?? '', /^jwt=;.*Max-Age=0/);

    const pre = await fetch(`${base}/user`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4200', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });

    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);

    const plain = await api('/tags', { headers: { Origin: 'http://localhost:4200' } });

    assert.equal(plain.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    assert.equal((await api('/nothing')).status, 404);
  });
});

describe('STATE_FILE persistence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'realworld-api-'));
  const stateFile = join(dir, 'state.json');

  after(() => rmSync(dir, { recursive: true, force: true }));

  test('users, tokens and articles survive a restart', async () => {
    const first = await start(stateFile);
    const call1 = client(first.base);
    const user = { username: 'persisted', email: 'persisted@example.com', password: 'secret1' };
    const reg = await call1('/users', { method: 'POST', body: { user } });

    assert.equal(reg.status, 201);

    const token = reg.json.user.token;

    await call1('/articles', { method: 'POST', token, body: { article: { title: 'Kept', description: 'd', body: 'b' } } });
    await call1('/articles/kept/favorite', { method: 'POST', token });
    await call1('/profiles/jake/follow', { method: 'POST', token });
    await stop(first.server);

    const second = await start(stateFile);
    const call2 = client(second.base);

    try {
      const login = await call2('/users/login', { method: 'POST', body: { user: { email: user.email, password: user.password } } });

      assert.equal(login.status, 200);
      assert.equal((await call2('/user', { token })).json.user.username, 'persisted');

      const article = (await call2('/articles/kept', { token })).json.article;

      assert.equal(article.favorited, true);
      assert.equal(article.favoritesCount, 1);
      assert.equal((await call2('/profiles/jake', { token })).json.profile.following, true);
      assert.equal((await call2('/articles?limit=10')).json.articlesCount, 6);
    } finally {
      await stop(second.server);
    }
  });

  test('without a state file nothing is shared between instances', async () => {
    const one = await start();
    const two = await start();

    try {
      await client(one.base)('/users', { method: 'POST', body: { user: { username: 'solo', email: 'solo@example.com', password: 'pw' } } });

      const res = await client(two.base)('/users/login', { method: 'POST', body: { user: { email: 'solo@example.com', password: 'pw' } } });

      assert.equal(res.status, 422);
    } finally {
      await stop(one.server);
      await stop(two.server);
    }
  });
});
