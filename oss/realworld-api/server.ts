// In-memory RealWorld ("Conduit") backend double. Node built-ins only.
// Start: `PORT=3100 node server.ts`. State lives in the process; a restart resets it,
// unless STATE_FILE names a JSON file: state (and the token secret) is then loaded from it
// on start and rewritten after every successful mutating request.
// Plain TypeScript with erasable syntax only: Node runs it directly via type stripping.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const AVATAR =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 8 8%22%3E%3Crect width=%228%22 height=%228%22 fill=%22%23ccc%22/%3E%3C/svg%3E';
const COOKIE = 'jwt';
// The double ships seeded users with known passwords and has no rate limits, so it listens on
// loopback only.
const HOST = 'localhost';

type Errors = Record<string, string[]>;

interface User {
  id: number;
  username: string;
  email: string;
  password: string;
  bio: string;
  image: string;
  following: Set<number>;
}

interface Article {
  id: number;
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  createdAt: string;
  updatedAt: string;
  authorId: number;
  favoritedBy: Set<number>;
}

interface Comment {
  id: number;
  articleId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorId: number;
}

interface Db {
  secret: string;
  users: User[];
  articles: Article[];
  comments: Comment[];
  nextUserId: number;
  nextArticleId: number;
  nextCommentId: number;
}

interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  // Undefined at runtime on 'optional' routes without a valid token; typed User for 'required' handlers.
  me: User;
}

type Result = [
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
];

class HttpError extends Error {
  status: number;
  errors: Errors;

  constructor(status: number, errors: Errors) {
    super(`HTTP ${status}`);
    this.status = status;
    this.errors = errors;
  }
}

const unprocessable = (errors: Errors) => new HttpError(422, errors);
const hasErrors = (errors: object) => Object.keys(errors).length > 0;

// ponytail: passwords are stored in plain text; this is a test double, not an auth server.
function createDb(): Db {
  const now = Date.now();
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * 60_000).toISOString();
  const db: Db = {
    secret: randomBytes(32).toString('hex'),
    users: [],
    articles: [],
    comments: [],
    nextUserId: 1,
    nextArticleId: 1,
    nextCommentId: 1,
  };

  const addUser = (username: string, bio: string) =>
    db.users.push({
      id: db.nextUserId++,
      username,
      email: `${username}@example.com`,
      password: 'password123',
      bio,
      image: '',
      following: new Set(),
    });
  const addArticle = (
    author: number,
    minutesAgo: number,
    title: string,
    description: string,
    body: string,
    tagList: string[],
  ) =>
    db.articles.push({
      id: db.nextArticleId++,
      slug: slugify(title),
      title,
      description,
      body,
      tagList,
      createdAt: at(minutesAgo),
      updatedAt: at(minutesAgo),
      authorId: author,
      favoritedBy: new Set(),
    });

  addUser('jake', 'I work at statefarm');
  addUser('anne', 'Writes about testing');
  addUser('carl', '');
  db.users[1].following.add(1);

  addArticle(
    1,
    50,
    'How to train your dragon',
    'Ever wonder how?',
    'It takes a Jacobian.',
    ['dragons', 'training'],
  );
  addArticle(
    2,
    40,
    'Mutation testing in practice',
    'Kill the mutants.',
    'Change code, run tests, count survivors.',
    ['testing', 'mutation'],
  );
  addArticle(
    3,
    30,
    'Playwright end to end',
    'Browsers under control.',
    'Drive a real browser from a script.',
    ['testing', 'playwright'],
  );
  addArticle(
    1,
    20,
    'Angular signals tour',
    'Reactive state, simply.',
    'Signals notify only what changed.',
    ['angular'],
  );
  addArticle(
    2,
    10,
    'Nx workspaces',
    'One repo, many projects.',
    'Affected commands save CI time.',
    ['nx', 'angular'],
  );

  db.comments.push({
    id: db.nextCommentId++,
    articleId: 1,
    body: 'Great read!',
    createdAt: at(5),
    updatedAt: at(5),
    authorId: 2,
  });
  db.articles[0].favoritedBy.add(2);

  return db;
}

function loadDb(file: string | undefined): Db {
  if (!file || !existsSync(file)) {
    return createDb();
  }

  const db: Db = JSON.parse(readFileSync(file, 'utf8'));

  db.users.forEach((u) => (u.following = new Set(u.following)));
  db.articles.forEach((a) => (a.favoritedBy = new Set(a.favoritedBy)));

  return db;
}

// Temp file in the same directory + rename: a crash never leaves a half-written state file. The file
// holds the token secret and the passwords, so only its owner can read it.
function saveDb(file: string, db: Db) {
  const tmp = `${file}.${process.pid}.tmp`;

  writeFileSync(
    tmp,
    JSON.stringify(db, (_key: string, value: unknown) =>
      value instanceof Set ? [...value] : value,
    ),
    { flag: 'w', mode: 0o600 },
  );
  renameSync(tmp, file);
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Only pages served from this machine get CORS access with credentials.
function loopbackOrigin(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }

  try {
    const url = new URL(origin);

    return url.protocol === 'http:' && LOOPBACK_HOST.test(url.host)
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
}

function slugify(title: string) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'article'
  );
}

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (secret: string, data: string) =>
  createHmac('sha256', secret).update(data).digest('base64url');

function issueToken(secret: string, user: User) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: user.id, username: user.username })}`;

  return `${head}.${sign(secret, head)}`;
}

function verifyToken(
  secret: string,
  token: string,
): { id: number; username: string } | null {
  const [h, p, s] = token.split('.');

  if (!s || sign(secret, `${h}.${p}`) !== s) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch {
    return null;
  }
}

function tokenFrom(req: IncomingMessage) {
  const auth = req.headers.authorization ?? '';
  const header = /^(?:Token|Bearer) (.+)$/i.exec(auth);

  if (header) {
    return header[1];
  }

  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(
    req.headers.cookie ?? '',
  );

  return cookie ? cookie[1] : null;
}

const cookieHeader = (value: string, maxAge: number) => ({
  'Set-Cookie': `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
});

export function createApiServer({
  stateFile = process.env.STATE_FILE,
}: { stateFile?: string } = {}) {
  const db = loadDb(stateFile);
  const issue = (user: User) => issueToken(db.secret, user);
  const userById = (id: number) => db.users.find((u) => u.id === id) as User;
  const maybeUserById = (id: number) => db.users.find((u) => u.id === id);
  const userByName = (name: string) =>
    db.users.find((u) => u.username === name);

  const userView = (u: User, token = issue(u)) => ({
    email: u.email,
    token,
    username: u.username,
    bio: u.bio,
    image: u.image || AVATAR,
  });
  const profileView = (u: User, me?: User) => ({
    username: u.username,
    bio: u.bio,
    image: u.image || AVATAR,
    following: !!me && me.following.has(u.id),
  });
  const articleView = (a: Article, me?: User) => ({
    slug: a.slug,
    title: a.title,
    description: a.description,
    body: a.body,
    tagList: a.tagList,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    favorited: !!me && a.favoritedBy.has(me.id),
    favoritesCount: a.favoritedBy.size,
    author: profileView(userById(a.authorId), me),
  });
  const commentView = (c: Comment, me?: User) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    author: profileView(userById(c.authorId), me),
  });

  const findArticle = (slug: string) => {
    const article = db.articles.find((a) => a.slug === slug);

    if (!article) {
      throw new HttpError(404, { article: ['not found'] });
    }

    return article;
  };
  const findUser = (username: string) => {
    const user = userByName(username);

    if (!user) {
      throw new HttpError(404, { profile: ['not found'] });
    }

    return user;
  };
  const requireOwner = (me: User, ownerId: number) => {
    if (me.id !== ownerId) {
      throw new HttpError(403, { authorization: ['you are not the author'] });
    }
  };

  const tagListOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((t) => String(t).trim()).filter(Boolean)
      : [];
  const required = (source: any, fields: string[]): Errors =>
    Object.fromEntries(
      fields
        .filter((f) => typeof source?.[f] !== 'string' || !source[f].trim())
        .map((f) => [f, ["can't be blank"]]),
    );
  const uniqueSlug = (title: string, selfId?: number) => {
    const base = slugify(title);

    return db.articles.some((a) => a.slug === base && a.id !== selfId)
      ? `${base}-${randomBytes(3).toString('hex')}`
      : base;
  };

  const listArticles = (
    articles: Article[],
    query: URLSearchParams,
    me?: User,
  ): Result => {
    const limit = countParam(query.get('limit'), 20);
    const offset = countParam(query.get('offset'), 0);
    const sorted = [...articles].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    return [
      200,
      {
        articles: sorted
          .slice(offset, offset + limit)
          .map((a) => articleView(a, me)),
        articlesCount: sorted.length,
      },
    ];
  };

  const setFavorite = (slug: string, me: User, on: boolean): Result => {
    const article = findArticle(slug);

    on ? article.favoritedBy.add(me.id) : article.favoritedBy.delete(me.id);

    return [200, { article: articleView(article, me) }];
  };
  const setFollow = (username: string, me: User, on: boolean): Result => {
    const target = findUser(username);

    on ? me.following.add(target.id) : me.following.delete(target.id);

    return [200, { profile: profileView(target, me) }];
  };

  // Handlers return [status, body?, headers?]. auth: 'required' (401 without a valid token),
  // 'optional' (me is set when a valid token is present) or undefined (token ignored).
  // Order matters: '/articles/feed' must precede '/articles/:slug'.
  const table: [
    method: string,
    pattern: string,
    auth: 'required' | 'optional' | undefined,
    handler: (ctx: Context) => Result,
  ][] = [
    [
      'POST',
      '/users',
      undefined,
      ({ body }) => {
        const input = body?.user;
        const errors = required(input, ['username', 'email', 'password']);

        if (!errors.email && db.users.some((u) => u.email === input.email)) {
          errors.email = ['has already been taken'];
        }

        if (!errors.username && userByName(input.username)) {
          errors.username = ['has already been taken'];
        }

        if (hasErrors(errors)) {
          throw unprocessable(errors);
        }

        const user: User = {
          id: db.nextUserId++,
          username: input.username,
          email: input.email,
          password: input.password,
          bio: '',
          image: '',
          following: new Set<number>(),
        };
        const token = issue(user);

        db.users.push(user);

        return [
          201,
          { user: userView(user, token) },
          cookieHeader(token, 86400),
        ];
      },
    ],
    [
      'POST',
      '/users/login',
      undefined,
      ({ body }) => {
        const input = body?.user;
        const errors = required(input, ['email', 'password']);

        if (hasErrors(errors)) {
          throw unprocessable(errors);
        }

        const user = db.users.find(
          (u) => u.email === input.email && u.password === input.password,
        );

        if (!user) {
          throw unprocessable({ message: ['User not found'] });
        }

        const token = issue(user);

        return [
          200,
          { user: userView(user, token) },
          cookieHeader(token, 86400),
        ];
      },
    ],
    [
      'POST',
      '/users/logout',
      undefined,
      () => [200, { message: 'Logged out' }, cookieHeader('', 0)],
    ],
    ['GET', '/user', 'required', ({ me }) => [200, { user: userView(me) }]],
    [
      'PUT',
      '/user',
      'required',
      ({ me, body }) => {
        const input = body?.user ?? {};
        const errors: Errors = {};

        if (typeof input.email === 'string' && input.email !== me.email) {
          if (!input.email.trim()) {
            errors.email = ["can't be blank"];
          } else if (db.users.some((u) => u.email === input.email)) {
            errors.email = ['has already been taken'];
          }
        }

        if (
          typeof input.username === 'string' &&
          input.username !== me.username
        ) {
          if (!input.username.trim()) {
            errors.username = ["can't be blank"];
          } else if (userByName(input.username)) {
            errors.username = ['has already been taken'];
          }
        }

        if (hasErrors(errors)) {
          throw unprocessable(errors);
        }

        for (const field of ['email', 'username', 'bio', 'image'] as const) {
          if (typeof input[field] === 'string') {
            me[field] = input[field];
          }
        }

        if (typeof input.password === 'string' && input.password) {
          me.password = input.password;
        }

        return [200, { user: userView(me) }];
      },
    ],

    [
      'GET',
      '/profiles/:username',
      'optional',
      ({ params, me }) => [
        200,
        { profile: profileView(findUser(params.username), me) },
      ],
    ],
    [
      'POST',
      '/profiles/:username/follow',
      'required',
      ({ params, me }) => setFollow(params.username, me, true),
    ],
    [
      'DELETE',
      '/profiles/:username/follow',
      'required',
      ({ params, me }) => setFollow(params.username, me, false),
    ],

    [
      'GET',
      '/tags',
      undefined,
      () => [
        200,
        { tags: [...new Set(db.articles.flatMap((a) => a.tagList))] },
      ],
    ],

    [
      'GET',
      '/articles/feed',
      'required',
      ({ query, me }) =>
        listArticles(
          db.articles.filter((a) => me.following.has(a.authorId)),
          query,
          me,
        ),
    ],
    [
      'GET',
      '/articles',
      'optional',
      ({ query, me }) => {
        const tag = query.get('tag');
        const author = query.get('author');
        const favorited = query.get('favorited');
        const matches = db.articles.filter(
          (a) =>
            (!tag || a.tagList.includes(tag)) &&
            (!author || userById(a.authorId).username === author) &&
            (!favorited ||
              [...a.favoritedBy].some(
                (id) => userById(id).username === favorited,
              )),
        );

        return listArticles(matches, query, me);
      },
    ],
    [
      'POST',
      '/articles',
      'required',
      ({ me, body }) => {
        const input = body?.article;
        const errors = required(input, ['title', 'description', 'body']);

        if (hasErrors(errors)) {
          throw unprocessable(errors);
        }

        const now = new Date().toISOString();
        const article: Article = {
          id: db.nextArticleId++,
          slug: uniqueSlug(input.title),
          title: input.title,
          description: input.description,
          body: input.body,
          tagList: tagListOf(input.tagList),
          createdAt: now,
          updatedAt: now,
          authorId: me.id,
          favoritedBy: new Set(),
        };

        db.articles.push(article);

        return [201, { article: articleView(article, me) }];
      },
    ],
    [
      'GET',
      '/articles/:slug',
      'optional',
      ({ params, me }) => [
        200,
        { article: articleView(findArticle(params.slug), me) },
      ],
    ],
    [
      'PUT',
      '/articles/:slug',
      'required',
      ({ params, me, body }) => {
        const article = findArticle(params.slug);
        const input = body?.article ?? {};

        requireOwner(me, article.authorId);

        if (typeof input !== 'object' || input === null) {
          throw unprocessable({ article: ['must be an object'] });
        }

        const errors: Errors = {};

        for (const field of ['title', 'description', 'body']) {
          if (
            field in input &&
            (typeof input[field] !== 'string' || !input[field].trim())
          ) {
            errors[field] = ["can't be blank"];
          }
        }

        if (hasErrors(errors)) {
          throw unprocessable(errors);
        }

        for (const field of ['title', 'description', 'body'] as const) {
          if (field in input) {
            article[field] = input[field];
          }
        }

        if ('title' in input) {
          article.slug = uniqueSlug(article.title, article.id);
        }

        if ('tagList' in input) {
          article.tagList = tagListOf(input.tagList);
        }

        article.updatedAt = new Date().toISOString();

        return [200, { article: articleView(article, me) }];
      },
    ],
    [
      'DELETE',
      '/articles/:slug',
      'required',
      ({ params, me }) => {
        const article = findArticle(params.slug);

        requireOwner(me, article.authorId);
        db.articles = db.articles.filter((a) => a !== article);
        db.comments = db.comments.filter((c) => c.articleId !== article.id);

        return [204];
      },
    ],
    [
      'POST',
      '/articles/:slug/favorite',
      'required',
      ({ params, me }) => setFavorite(params.slug, me, true),
    ],
    [
      'DELETE',
      '/articles/:slug/favorite',
      'required',
      ({ params, me }) => setFavorite(params.slug, me, false),
    ],

    [
      'GET',
      '/articles/:slug/comments',
      'optional',
      ({ params, me }) => {
        const article = findArticle(params.slug);
        const comments = db.comments
          .filter((c) => c.articleId === article.id)
          .sort((a, b) => b.id - a.id);

        return [200, { comments: comments.map((c) => commentView(c, me)) }];
      },
    ],
    [
      'POST',
      '/articles/:slug/comments',
      'required',
      ({ params, me, body }) => {
        const article = findArticle(params.slug);
        const errors = required(body?.comment, ['body']);

        if (hasErrors(errors)) {
          throw unprocessable(errors);
        }

        const now = new Date().toISOString();
        const comment: Comment = {
          id: db.nextCommentId++,
          articleId: article.id,
          body: body.comment.body,
          createdAt: now,
          updatedAt: now,
          authorId: me.id,
        };

        db.comments.push(comment);

        return [201, { comment: commentView(comment, me) }];
      },
    ],
    [
      'DELETE',
      '/articles/:slug/comments/:id',
      'required',
      ({ params, me }) => {
        const article = findArticle(params.slug);
        const comment = db.comments.find(
          (c) => c.id === Number(params.id) && c.articleId === article.id,
        );

        if (!comment) {
          throw new HttpError(404, { comment: ['not found'] });
        }

        requireOwner(me, comment.authorId);
        db.comments = db.comments.filter((c) => c !== comment);

        return [204];
      },
    ],
  ];
  const routes = table.map(([method, pattern, auth, handler]) => ({
    method,
    auth,
    handler,
    regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`),
  }));

  const readJson = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const text = Buffer.concat(chunks).toString();

    if (!text.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, { body: ['is not valid JSON'] });
    }
  };

  const respond = (
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const origin = loopbackOrigin(req.headers.origin);

    res.writeHead(status, {
      ...(origin
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true',
          }
        : {}),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        req.headers['access-control-request-headers'] ??
        'Content-Type, Authorization, Accept',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json; charset=utf-8' }),
      ...headers,
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));

    if (process.env.DEBUG) {
      console.log(req.method, req.url, status);
    }
  };

  return createServer(async (req, res) => {
    try {
      // A remote page that rebinds its own host name to 127.0.0.1 still sends that name.
      if (!LOOPBACK_HOST.test(req.headers.host ?? '')) {
        return respond(req, res, 403, {
          errors: { host: ['is not loopback'] },
        });
      }

      // CORS only hides responses; a simple cross-site POST would still register users and rewrite state.
      if (
        req.headers.origin !== undefined &&
        !loopbackOrigin(req.headers.origin)
      ) {
        return respond(req, res, 403, {
          errors: { origin: ['is not loopback'] },
        });
      }

      if (req.method === 'OPTIONS') {
        return respond(req, res, 204);
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const path =
        url.pathname.startsWith('/api/') || url.pathname === '/api'
          ? url.pathname.slice(4) || '/'
          : null;
      const matches =
        path === null ? [] : routes.filter((r) => r.regex.test(path));

      if (matches.length === 0) {
        throw new HttpError(404, { path: ['not found'] });
      }

      const route = matches.find((r) => r.method === req.method);

      if (!route) {
        throw new HttpError(405, { method: [`${req.method} not allowed`] });
      }

      const params = Object.fromEntries(
        Object.entries(route.regex.exec(path as string)?.groups ?? {}).map(
          ([k, v]) => [k, decodeParam(v)],
        ),
      );
      const token = tokenFrom(req);
      const claims = token ? verifyToken(db.secret, token) : null;
      const me = claims ? maybeUserById(claims.id) : undefined;

      if (route.auth === 'required' && !me) {
        throw new HttpError(401, { token: ['is missing or invalid'] });
      }

      const body =
        req.method === 'POST' || req.method === 'PUT'
          ? await readJson(req)
          : undefined;
      const [status, payload, headers] = route.handler({
        params,
        query: url.searchParams,
        body,
        me: me as User,
      });

      if (stateFile && req.method !== 'GET') {
        saveDb(stateFile, db);
      }

      respond(req, res, status, payload, headers);
    } catch (error) {
      if (error instanceof HttpError) {
        respond(req, res, error.status, { errors: error.errors });
      } else {
        console.error(error);
        respond(req, res, 500, { errors: { server: ['internal error'] } });
      }
    }
  });
}

function countParam(value: string | null, fallback: number): number {
  const count = Number(value);

  return value === null || value === '' || !Number.isInteger(count) || count < 0
    ? fallback
    : count;
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(404, { path: ['not found'] });
  }
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3100);

  createApiServer().listen(port, HOST, () => {
    console.log(`RealWorld API double listening on http://${HOST}:${port}/api`);
  });
}
