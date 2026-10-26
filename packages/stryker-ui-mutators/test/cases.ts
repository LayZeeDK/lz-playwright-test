// Synthetic UI shapes from the open-source repos the runner was exercised on, as JSX, with the UI mutants the
// design (docs/design/playwright-mutators.md) says each gives. An empty expect is a must-not-generate case. The
// mined rows and their transcription notes are in spikes/ui-mutator-cases/.
import type { OperatorName } from '../src/operators.ts';

export interface Case {
  readonly id: string;
  readonly title: string;
  // `<repo>@<commit>:<path>:<line>`, the shape this case reproduces; `design:<section>` for a design rule.
  readonly origin: string;
  // Module code before the component, for shapes that need a same-file declaration.
  readonly setup?: string;
  // One JSX expression; free identifiers stand for props.
  readonly jsx: string;
  // Each mutant as [operator, replacement source]; mutation names are in the mined-*.md files.
  readonly expect: readonly (readonly [OperatorName, string])[];
  // Text the instrumented file must contain, for a rule about placement rather than about the mutants.
  readonly instrumented?: string;
}

const RW = 'realworld@bc7158d:';
const YETI = 'ngx-yeti@87d4377:apps/yeti-app/src/app/fixtures/';
const ANALOG = 'analog@a377078ec:';
const HELLO = 'stryker-playwright-hello-world@fa6dd64:';
const DEMO = 'stryker-playwright-runner@f00806e:apps/demo-app/src/app/';
const RULES = 'design:Rules the synthetic cases settled';

export const cases: readonly Case[] = [
  {
    id: 'realworld-1',
    title: 'a button with text and a prop handler loses both',
    origin: `${RW}libs/settings/feature-settings/src/settings.component.html:67`,
    jsx: '<button className="btn btn-outline-danger" onClick={logout}>Or click here to logout.</button>',
    expect: [
      [
        'ElementRole',
        '<span className="btn btn-outline-danger" onClick={logout}>Or click here to logout.</span>',
      ],
      ['EventHandler', 'onClick={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-2',
    title: 'a plain-string placeholder is emptied',
    origin: `${RW}libs/auth/feature-auth/src/login/login.component.html:18`,
    jsx: '<input type="email" id="email" placeholder="Email" />',
    expect: [['LabelAttribute', 'placeholder=""']],
  },
  {
    id: 'realworld-3',
    title: 'a form submit handler from props is removed',
    origin: `${RW}libs/auth/feature-auth/src/login/login.component.html:12`,
    jsx: '<form onSubmit={onSubmit}></form>',
    expect: [['EventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'realworld-4',
    title: 'a delete button with a prop handler loses handler, text and role',
    origin: `${RW}libs/articles/feature-article/src/article-meta/article-meta.component.html:17`,
    jsx: '<button className="btn btn-sm btn-outline-danger" onClick={deleteArticle}>Delete Article</button>',
    expect: [
      [
        'ElementRole',
        '<span className="btn btn-sm btn-outline-danger" onClick={deleteArticle}>Delete Article</span>',
      ],
      ['EventHandler', 'onClick={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-5',
    title: 'an inline arrow handler is left to ArrowFunction',
    origin: `${RW}libs/ui/components/src/pager/pager.component.html:7`,
    jsx: '<li onClick={() => setPage(pageNumber)}></li>',
    expect: [],
  },
  {
    id: 'realworld-6',
    title: 'a same-file handler referenced once is skipped',
    origin: `${RW}libs/settings/feature-settings/src/settings.component.html:67`,
    setup: 'function logout() {\n  store.logout();\n}',
    jsx: '<button onClick={logout}>Logout</button>',
    expect: [
      ['ElementRole', '<span onClick={logout}>Logout</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-7',
    title: 'a ternary with a unary test forces each branch',
    origin: `${RW}apps/conduit/src/app/layout/navbar/navbar.component.html:5`,
    jsx: '<nav>{!isLoggedIn ? <GuestNav /> : <MemberNav />}</nav>',
    expect: [
      ['ConditionalElement', '<GuestNav />'],
      ['ConditionalElement', '<MemberNav />'],
    ],
  },
  {
    id: 'realworld-8',
    title: 'an identifier guard is removed',
    origin: `${RW}libs/articles/feature-article/src/article.component.html:1`,
    jsx: '<main>{article && <ArticlePage article={article} />}</main>',
    expect: [['ConditionalElement', '<ArticlePage article={article} />']],
  },
  {
    id: 'realworld-9',
    title: 'a comparison guard is left to ConditionalExpression',
    origin: `${RW}libs/core/forms/src/lib/list-errors/list-errors.component.html:1`,
    jsx: '<div>{errors.length > 0 && <ul className="error-messages" />}</div>',
    expect: [],
  },
  {
    id: 'realworld-10',
    title: 'a link with a computed href is emptied and swapped',
    origin: `${RW}libs/articles/feature-article/src/article-meta/article-meta.component.html:2`,
    jsx: '<a data-testid="article-author" href={\'/profile/\' + username}></a>',
    expect: [
      ['ElementRole', '<span data-testid="article-author"></span>'],
      ['UrlAttribute', 'href=""'],
    ],
  },
  {
    id: 'realworld-11',
    title: 'a nav link loses href, role and text',
    origin: `${RW}apps/conduit/src/app/layout/navbar/navbar.component.html:11`,
    jsx: '<a className="nav-link" href="/login">Sign in</a>',
    expect: [
      ['ElementRole', '<span className="nav-link">Sign in</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-12',
    title: 'a logical disabled expression is forced off',
    origin: `${RW}libs/auth/feature-auth/src/login/login.component.html:36`,
    jsx: '<button data-testid="sign-in" disabled={form.invalid || form.pending} type="submit">Sign in</button>',
    expect: [
      ['ElementRole', '<span data-testid="sign-in">Sign in</span>'],
      ['DisabledAttribute', 'disabled={false}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-13',
    title: 'a submit button is swapped for a span',
    origin: `${RW}libs/auth/feature-auth/src/login/login.component.html:33`,
    jsx: '<button data-testid="sign-in" disabled={form.invalid || form.pending} type="submit">Sign in</button>',
    expect: [
      ['ElementRole', '<span data-testid="sign-in">Sign in</span>'],
      ['DisabledAttribute', 'disabled={false}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-14',
    title: 'a comparison hidden expression is forced off',
    origin: `${RW}libs/articles/feature-article/src/article-comment/article-comment.component.html:16`,
    jsx: '<span className="mod-options" hidden={currentUser.username !== comment.author.username}></span>',
    expect: [['HiddenAttribute', 'hidden={false}']],
  },
  {
    id: 'realworld-15',
    title: 'a negated hidden expression is forced off',
    origin: `${RW}libs/articles/feature-article/src/article-meta/article-meta.component.html:12`,
    jsx: '<span hidden={!canModify}></span>',
    expect: [['HiddenAttribute', 'hidden={false}']],
  },
  {
    id: 'realworld-16',
    title: 'aria-hidden with a boolean literal is left to BooleanLiteral',
    origin: `${RW}libs/ui/components/src/avatar/avatar.component.html:4`,
    jsx: '<span className="avatar fallback" aria-hidden={true}>{initials}</span>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'realworld-17',
    title: 'a member expression child is emptied',
    origin: `${RW}libs/articles/feature-article/src/article.component.html:5`,
    jsx: '<h1 data-testid="article-title">{article.title}</h1>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'realworld-18',
    title: 'parentheses around a child are not text',
    origin: `${RW}libs/articles/feature-article/src/article-meta/article-meta.component.html:46`,
    jsx: '<span className="counter">({article.favoritesCount})</span>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'realworld-19',
    title: 'non-breaking-space entities are not text',
    origin: `${RW}libs/articles/feature-article/src/article-meta/article-meta.component.html:35`,
    jsx: '<p><i />&nbsp;&nbsp;<i /></p>',
    expect: [],
  },
  {
    id: 'realworld-20',
    title: 'a sentence with two links gives text, url and role mutants',
    origin: `${RW}libs/articles/feature-article/src/article.component.html:43`,
    jsx: '<><a href="/login">Sign in</a> or <a href="/register">sign up</a> to add comments on this article.</>',
    expect: [
      ['ElementRole', '<span>Sign in</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
      ['TextLiteral', ''],
      ['ElementRole', '<span>sign up</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'realworld-21',
    title: 'a bound alt is emptied',
    origin: `${RW}libs/ui/components/src/avatar/avatar.component.html:2`,
    jsx: '<img src={src} alt={username} />',
    expect: [['LabelAttribute', 'alt=""']],
  },
  {
    id: 'realworld-22',
    title: 'an a without href keeps its tag',
    origin: `${RW}libs/ui/components/src/pager/pager.component.html:9`,
    jsx: '<a data-testid="pagination-link" className="page-link">{pageNumber}</a>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'ngx-yeti-1',
    title:
      'a negated disabled expression is forced off; the inline handler is skipped',
    origin: `${YETI}button-fixture.ts:21`,
    jsx: '<button type="button" disabled={!live} onClick={() => setLive(false)}>Remove the live buttons</button>',
    expect: [
      [
        'ElementRole',
        '<span onClick={() => setLive(false)}>Remove the live buttons</span>',
      ],
      ['DisabledAttribute', 'disabled={false}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-2',
    title: 'an identifier guard around a form is removed',
    origin: `${YETI}button-fixture.ts:26`,
    jsx: '<div>{live && <form id="button-form"></form>}</div>',
    expect: [['ConditionalElement', '<form id="button-form"></form>']],
  },
  {
    id: 'ngx-yeti-3',
    title:
      'a strict-inequality guard is skipped; the link inside still mutates',
    origin: `${YETI}fragment-links-fixture.ts:38`,
    jsx: '<div>{page !== null && <a href="../two">Open page two</a>}</div>',
    expect: [
      ['ElementRole', '<span>Open page two</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-4',
    title: 'a bare disabled on an a without href is forced off',
    origin: `${YETI}button-fixture.ts:68`,
    jsx: '<a id="previous" disabled>Previous</a>',
    expect: [
      ['DisabledAttribute', 'disabled={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-5',
    title: 'a conditional href and a disabled expression',
    origin: `${YETI}button-fixture.ts:61`,
    jsx: '<a id="next" disabled={last} href={last ? null : \'/replay\'}>Next</a>',
    expect: [
      ['ElementRole', '<span id="next">Next</span>'],
      ['DisabledAttribute', 'disabled={false}'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-6',
    title: 'a router link loses href, role and text',
    origin: `${YETI}button-fixture.ts:24`,
    jsx: '<a href="/replay">Leave for a page without buttons</a>',
    expect: [
      ['ElementRole', '<span>Leave for a page without buttons</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-7',
    title: 'a fragment link loses href, role and text',
    origin: `${YETI}button-fixture.ts:92`,
    jsx: '<a id="contact-link" href="#contact">Contact us</a>',
    expect: [
      ['ElementRole', '<span id="contact-link">Contact us</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-8',
    title: 'a group aria-label is emptied',
    origin: `${YETI}buttons-fixture.ts:50`,
    jsx: '<div aria-label="Text style"></div>',
    expect: [['LabelAttribute', 'aria-label=""']],
  },
  {
    id: 'ngx-yeti-9',
    title:
      'an svg keeps its img role, as Playwright gives svg that role, and loses its aria-label',
    origin: `${YETI}icon-fixture.ts:36`,
    jsx: '<svg role="img" aria-label="Warning" viewBox="0 0 24 24"></svg>',
    expect: [['LabelAttribute', 'aria-label=""']],
  },
  {
    id: 'ngx-yeti-10',
    title: 'a status role and its aria-label are removed',
    origin: `${YETI}spinner-fixture.ts:23`,
    jsx: '<span id="loading-spinner" role="status" aria-label="Loading"></span>',
    expect: [
      ['ElementRole', 'role={undefined}'],
      ['LabelAttribute', 'aria-label=""'],
    ],
  },
  {
    id: 'ngx-yeti-11',
    title: 'a plain-string alt is emptied',
    origin: `${YETI}card-fixture.ts:36`,
    jsx: '<img src="trail.svg" width="1600" height="900" alt="A mountain trail at dawn" />',
    expect: [['LabelAttribute', 'alt=""']],
  },
  {
    id: 'ngx-yeti-12',
    title: 'an iframe title is emptied',
    origin: `${YETI}frame-fixture.ts:44`,
    jsx: '<iframe title="Trail notes" srcDoc="<p>Six miles and one summit.</p>"></iframe>',
    expect: [['LabelAttribute', 'title=""']],
  },
  {
    id: 'ngx-yeti-13',
    title: 'aria-labelledby is emptied',
    origin: `${YETI}fragment-links-fixture.ts:48`,
    jsx: '<svg aria-labelledby="svg-link-text" height="24" width="160"></svg>',
    expect: [['LabelAttribute', 'aria-labelledby=""']],
  },
  {
    id: 'ngx-yeti-14',
    title: 'aria-hidden on a decorative svg is skipped',
    origin: `${YETI}button-fixture.ts:82`,
    jsx: '<svg aria-hidden="true" viewBox="0 0 24 24"></svg>',
    expect: [],
  },
  {
    id: 'ngx-yeti-15',
    title: 'aria-pressed is negated; a const arrow referenced once is skipped',
    origin: `${YETI}button-fixture.ts:29`,
    setup: 'const pressBold = () => {\n  setBold((b) => !b);\n};',
    jsx: '<button id="bold" type="button" aria-pressed={bold} onClick={pressBold}>Bold</button>',
    expect: [
      [
        'ElementRole',
        '<span id="bold" aria-pressed={bold} onClick={pressBold}>Bold</span>',
      ],
      ['StateAttribute', 'aria-pressed={!bold}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-16',
    title: 'a const arrow referenced twice is removed at each reference',
    origin: `${YETI}button-fixture.ts:29`,
    setup: 'const pressBold = () => {\n  setBold((b) => !b);\n};',
    jsx: '<div><button id="bold" type="button" onClick={pressBold}>Bold</button><button id="bold-key" type="button" onClick={pressBold}>Bold</button></div>',
    expect: [
      ['ElementRole', '<span id="bold" onClick={pressBold}>Bold</span>'],
      ['EventHandler', 'onClick={undefined}'],
      ['TextLiteral', ''],
      ['ElementRole', '<span id="bold-key" onClick={pressBold}>Bold</span>'],
      ['EventHandler', 'onClick={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-17',
    title: 'an output child is emptied',
    origin: `${YETI}button-fixture.ts:39`,
    jsx: '<output id="bold-presses">{presses}</output>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'ngx-yeti-18',
    title: 'aria-disabled is forced off and aria-busy is untouched',
    origin: `${YETI}button-fixture.ts:69`,
    jsx: '<button id="busy" type="button" aria-busy={waiting} aria-disabled={waiting}>Saving</button>',
    expect: [
      [
        'ElementRole',
        '<span id="busy" aria-busy={waiting} aria-disabled={waiting}>Saving</span>',
      ],
      ['DisabledAttribute', 'aria-disabled={false}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-19',
    title:
      'a list role equal to the implicit role is kept; each item text is emptied',
    origin: `${YETI}cluster-fixture.ts:24`,
    jsx: '<ul id="tags-cluster" role="list"><li>layout</li><li>intrinsic</li></ul>',
    expect: [
      ['TextLiteral', ''],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-20',
    title: 'a plain button is swapped for a span',
    origin: `${YETI}button-fixture.ts:28`,
    jsx: '<button id="save" type="button">Save</button>',
    expect: [
      ['ElementRole', '<span id="save">Save</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-21',
    title: 'an alt that is already empty gets no mutant',
    origin: 'ngx-yeti@87d4377:packages/ngx-yeti/layer/src/layer.stories.ts:153',
    jsx: '<img src={trail} width="1600" height="900" alt="" />',
    expect: [],
  },
  {
    id: 'analog-1',
    title: 'a home link around a heading',
    origin: `${ANALOG}libs/top-bar/src/lib/top-bar/template.html:16`,
    jsx: '<a href="/"><h1>My Store</h1></a>',
    expect: [
      ['ElementRole', '<span><h1>My Store</h1></span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-2',
    title: 'a link with an icon ligature and text gives two text mutants',
    origin: `${ANALOG}libs/top-bar/src/lib/top-bar/template.html:20`,
    jsx: '<a href="/cart" className="button fancy-button"><i className="material-icons">shopping_cart</i>Checkout</a>',
    expect: [
      [
        'ElementRole',
        '<span className="button fancy-button"><i className="material-icons">shopping_cart</i>Checkout</span>',
      ],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-3',
    title:
      'a bound title is emptied; a template-literal href is left to StringLiteral',
    origin: `${ANALOG}apps/analog-app/src/app/pages/(home).page.ts:22`,
    jsx: "<a title={product.name + ' details'} href={`/products/${product.id}`}>{product.name}</a>",
    expect: [
      [
        'ElementRole',
        "<span title={product.name + ' details'}>{product.name}</span>",
      ],
      ['ChildExpression', 'null'],
      ['LabelAttribute', 'title=""'],
    ],
  },
  {
    id: 'analog-4',
    title: 'a member-expression guard around text and a child',
    origin: `${ANALOG}apps/analog-app/src/app/pages/(home).page.ts:32`,
    jsx: '<div>{product.description && <p>Description: {product.description}</p>}</div>',
    expect: [
      ['ConditionalElement', '<p>Description: {product.description}</p>'],
      ['TextLiteral', ''],
      ['ChildExpression', 'null'],
    ],
  },
  {
    id: 'analog-5',
    title: 'a same-file const arrow referenced once is skipped',
    origin: `${ANALOG}apps/analog-app/src/app/pages/(home).page.ts:35`,
    setup:
      "const share = () => {\n  window.alert('The product has been shared!');\n};",
    jsx: '<button type="button" onClick={share}>Share</button>',
    expect: [
      ['ElementRole', '<span onClick={share}>Share</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-6',
    title: 'an imported handler is removed',
    origin: `${ANALOG}apps/analog-app/src/app/pages/(home).page.ts:35`,
    setup: "import { share } from './share';",
    jsx: '<button type="button" onClick={share}>Share</button>',
    expect: [
      ['ElementRole', '<span onClick={share}>Share</span>'],
      ['EventHandler', 'onClick={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-7',
    title: 'a same-file handler passed once to a component is skipped',
    origin: `${ANALOG}apps/analog-app/src/app/pages/(home).page.ts:36`,
    setup:
      "const onNotify = () => {\n  window.alert('You will be notified when the product goes on sale');\n};",
    jsx: '<ProductAlerts product={product} onNotify={onNotify} />',
    expect: [],
  },
  {
    id: 'analog-8',
    title: 'a logical guard is skipped; the button inside still mutates',
    origin: `${ANALOG}apps/analog-app/src/app/product-alerts/product-alerts.component.ts:7`,
    jsx: '<div>{product() && product()!.price > 700 && (<p><button type="button" onClick={() => notify.emit()}>Notify Me</button></p>)}</div>',
    expect: [
      ['ElementRole', '<span onClick={() => notify.emit()}>Notify Me</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-9',
    title: 'a call-expression ternary forces each branch',
    origin: `${ANALOG}apps/analog-app/src/app/pages/newsletter.page.ts:20`,
    jsx: '<div>{signedUpEmail() ? <div id="signup-message">Thanks for signing up, {signedUpEmail()}!</div> : <form method="post"><button type="submit">Submit</button></form>}</div>',
    expect: [
      [
        'ConditionalElement',
        '<div id="signup-message">Thanks for signing up, {signedUpEmail()}!</div>',
      ],
      [
        'ConditionalElement',
        '<form method="post"><button type="submit">Submit</button></form>',
      ],
      ['TextLiteral', ''],
      ['ChildExpression', 'null'],
      ['ElementRole', '<span>Submit</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-10',
    title: 'an optional-chain guard and child',
    origin: `${ANALOG}apps/analog-app/src/app/pages/newsletter.page.ts:40`,
    jsx: '<div>{errors()?.email && <p>{errors()?.email}</p>}</div>',
    expect: [
      ['ConditionalElement', '<p>{errors()?.email}</p>'],
      ['ChildExpression', 'null'],
    ],
  },
  {
    id: 'analog-11',
    title: 'a same-file submit handler referenced once is skipped',
    origin: `${ANALOG}apps/analog-app/src/app/pages/cart.page.ts:25`,
    setup: 'const onSubmit = () => {\n  clearCart();\n};',
    jsx: '<form onSubmit={onSubmit}></form>',
    expect: [],
  },
  {
    id: 'analog-12',
    title: 'a member-expression submit handler is removed',
    origin: `${ANALOG}apps/analog-app/src/app/pages/cart.page.ts:25`,
    jsx: '<form onSubmit={props.onSubmit}></form>',
    expect: [['EventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'analog-13',
    title: 'a label loses htmlFor and its padded text',
    origin: `${ANALOG}apps/analog-app/src/app/pages/cart.page.ts:27`,
    jsx: '<div><label htmlFor="name"> Name </label><input id="name" type="text" /></div>',
    expect: [
      ['LabelAttribute', 'htmlFor=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-14',
    title: 'a label whose htmlFor points at no element still mutates',
    origin: `${ANALOG}apps/analog-app/src/app/pages/newsletter.page.ts:33`,
    jsx: '<div><label htmlFor="email"> Email </label><input type="email" name="email" /></div>',
    expect: [
      ['LabelAttribute', 'htmlFor=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-15',
    title: 'a submit button keeps its type',
    origin: `${ANALOG}apps/analog-app/src/app/pages/cart.page.ts:36`,
    jsx: '<button className="button" type="submit">Purchase</button>',
    expect: [
      ['ElementRole', '<span className="button">Purchase</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-16',
    title: 'trailing whitespace text is not text',
    origin: `${ANALOG}apps/analog-app/src/app/pages/cart.page.ts:19`,
    jsx: '<div className="cart-item"><span>{item.name} </span></div>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'analog-17',
    title: 'an em dash between two children is not text',
    origin: `${ANALOG}apps/analog-app/src/app/pages/server-functions.page.ts:24`,
    jsx: '<li>{p.name} — {p.price}</li>',
    expect: [
      ['ChildExpression', 'null'],
      ['ChildExpression', 'null'],
    ],
  },
  {
    id: 'analog-18',
    title: 'a heading text is emptied',
    origin: `${ANALOG}apps/analog-app/src/app/pages/products.[productId].page.ts:15`,
    jsx: '<h2>Product Details</h2>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'analog-19',
    title: 'an identifier guard around a details block',
    origin: `${ANALOG}apps/analog-app/src/app/pages/products.[productId].page.ts:17`,
    jsx: '<section>{product && (<div><h3>{product.name}</h3><p>{product.description}</p><button type="button" onClick={() => addToCart(product)}>Buy</button></div>)}</section>',
    expect: [
      [
        'ConditionalElement',
        '<div><h3>{product.name}</h3><p>{product.description}</p><button type="button" onClick={() => addToCart(product)}>Buy</button></div>',
      ],
      ['ChildExpression', 'null'],
      ['ChildExpression', 'null'],
      ['ElementRole', '<span onClick={() => addToCart(product)}>Buy</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'analog-20',
    title: 'a map child is left to the later ListExpression',
    origin: `${ANALOG}apps/analog-app/src/app/pages/(home).page.ts:19`,
    jsx: '<div>{data().products.map((product) => <div key={product.id}></div>)}</div>',
    expect: [],
  },
  {
    id: 'analog-21',
    title: 'an identifier ternary between two component branches',
    origin: `${ANALOG}apps/analog-app/src/stories/header.component.ts:38`,
    jsx: '<header>{user ? <div><Button size="small" onClicked={() => logout.emit(event)} label="Log out" /></div> : <div><Button size="small" label="Log in" /></div>}</header>',
    expect: [
      [
        'ConditionalElement',
        '<div><Button size="small" onClicked={() => logout.emit(event)} label="Log out" /></div>',
      ],
      [
        'ConditionalElement',
        '<div><Button size="small" label="Log in" /></div>',
      ],
    ],
  },
  {
    id: 'analog-24',
    title: 'a shipping link loses href, role and text',
    origin: `${ANALOG}apps/analog-app/src/app/pages/cart.page.ts:15`,
    jsx: '<a href="/shipping">Shipping Prices</a>',
    expect: [
      ['ElementRole', '<span>Shipping Prices</span>'],
      ['UrlAttribute', 'href=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'hello-1',
    title: 'a heading text is emptied',
    origin: `${HELLO}index.html:8`,
    jsx: '<h1>Stryker + Playwright Hello World</h1>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'hello-2',
    title: 'a label text is emptied',
    origin: `${HELLO}index.html:10`,
    jsx: '<label htmlFor="amount">Betrag</label>',
    expect: [
      ['LabelAttribute', 'htmlFor=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'hello-3',
    title: 'a label htmlFor is emptied',
    origin: `${HELLO}index.html:10`,
    jsx: '<label htmlFor="amount">Betrag</label>',
    expect: [
      ['LabelAttribute', 'htmlFor=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'hello-4',
    title: 'a button text is emptied',
    origin: `${HELLO}index.html:13`,
    jsx: '<button id="btn">Berechnen</button>',
    expect: [
      ['ElementRole', '<span id="btn">Berechnen</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'hello-5',
    title: 'a button is swapped for a span',
    origin: `${HELLO}index.html:13`,
    jsx: '<button id="btn">Berechnen</button>',
    expect: [
      ['ElementRole', '<span id="btn">Berechnen</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'hello-6',
    title: 'text before an element keeps its separating space',
    origin: `${HELLO}index.html:15`,
    jsx: '<p>Ergebnis: <span id="result"></span></p>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'hello-7',
    title: 'an empty span gives nothing',
    origin: `${HELLO}index.html:17`,
    jsx: '<span id="result"></span>',
    expect: [],
  },
  {
    id: 'hello-8',
    title: 'id and type give nothing',
    origin: `${HELLO}index.html:11`,
    jsx: '<input id="amount" type="number" />',
    expect: [],
  },
  {
    id: 'hello-9',
    title: 'an inline block-body handler is left to ArrowFunction',
    origin: `${HELLO}index.html:23`,
    jsx: '<button id="btn" onClick={() => { setResult(calculatePrice(value)); }}>Berechnen</button>',
    expect: [
      [
        'ElementRole',
        '<span id="btn" onClick={() => { setResult(calculatePrice(value)); }}>Berechnen</span>',
      ],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'demo-1',
    title: 'a Cart heading text is emptied',
    origin: `${DEMO}app.tsx:28`,
    jsx: '<h1>Cart</h1>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-2',
    title: 'an About heading text is emptied',
    origin: `${DEMO}app.tsx:69`,
    jsx: '<h1>About</h1>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-3',
    title: 'a router Link to is emptied',
    origin: `${DEMO}app.tsx:61`,
    jsx: '<Link to="/about">About</Link>',
    expect: [
      ['UrlAttribute', 'to=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'demo-4',
    title: 'a router Link to the root is emptied',
    origin: `${DEMO}app.tsx:70`,
    jsx: '<Link to="/">Back to cart</Link>',
    expect: [
      ['UrlAttribute', 'to=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'demo-5',
    title: 'a wrapping label text is emptied',
    origin: `${DEMO}app.tsx:49`,
    jsx: '<label>Discount code<input value={code} /></label>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-6',
    title: 'a term text is emptied',
    origin: `${DEMO}app.tsx:54`,
    jsx: '<dt>Subtotal</dt>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-7',
    title: 'a template-literal aria-label is not a plain string',
    origin: `${DEMO}app.tsx:36`,
    jsx: '<input type="number" aria-label={`${line.name} quantity`} />',
    expect: [],
  },
  {
    id: 'demo-8',
    title: 'an inline change handler is left to ArrowFunction',
    origin: `${DEMO}app.tsx:38`,
    jsx: '<input onChange={(event) => setQuantity(line.name, Number(event.target.value))} />',
    expect: [],
  },
  {
    id: 'demo-9',
    title: 'a controlled input with an inline handler gives nothing',
    origin: `${DEMO}app.tsx:51`,
    jsx: '<input value={code} onChange={(event) => setCode(event.target.value)} />',
    expect: [],
  },
  {
    id: 'demo-10',
    title: 'a formatted call child is emptied',
    origin: `${DEMO}app.tsx:44`,
    jsx: '<output>{formatPrice(lineTotal(line))}</output>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'demo-11',
    title: 'a test-id element child is emptied',
    origin: `${DEMO}app.tsx:55`,
    jsx: '<dd data-testid="subtotal">{formatPrice(subtotal(lines))}</dd>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'demo-12',
    title: 'a label child and the input aria-label are emptied',
    origin: `${DEMO}app.tsx:33`,
    jsx: '<label>{line.name}<input aria-label="x" /></label>',
    expect: [
      ['ChildExpression', 'null'],
      ['LabelAttribute', 'aria-label=""'],
    ],
  },
  {
    id: 'demo-13',
    title: 'a map child is left to the later ListExpression',
    origin: `${DEMO}app.tsx:30`,
    jsx: '<ul>{lines.map((line) => (<li key={line.name}>x</li>))}</ul>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-14',
    title: 'a comparison guard is left to ConditionalExpression',
    origin: `${DEMO}price-tag.tsx:22`,
    jsx: '<p>{off > 0 && (<s>x</s>)}</p>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-15',
    title: 'a ternary of strings is not a JSX conditional',
    origin: `${DEMO}price-tag.tsx:26`,
    jsx: "<strong>{off >= 50 ? 'Half' : `${off}% off`}</strong>",
    expect: [],
  },
  {
    id: 'demo-16',
    title: 'a ternary outside JSX is left to ConditionalExpression',
    origin: `${DEMO}price-tag.tsx:17`,
    setup: 'const off = c === undefined ? 0 : percentOff(c);',
    jsx: '<s data-off={off} />',
    expect: [],
  },
  {
    id: 'demo-17',
    title: 'string-literal space children give nothing',
    origin: `${DEMO}price-tag.tsx:24`,
    jsx: "<p>{' '}<s>x</s>{' '}</p>",
    expect: [['TextLiteral', '']],
  },
  {
    id: 'demo-18',
    title: 'a price child is emptied',
    origin: `${DEMO}price-tag.tsx:21`,
    jsx: '<span data-testid="price">{formatPrice(cents)}</span>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'demo-19',
    title: 'a component with a numeric prop gives nothing',
    origin: `${DEMO}price-tag.story.tsx:3`,
    jsx: '<PriceTag cents={12_00} />',
    expect: [],
  },
  {
    id: 'demo-20',
    title: 'a Route path and element give nothing',
    origin: `${DEMO}app.tsx:78`,
    jsx: '<Route path="/" element={<Cart />} />',
    expect: [],
  },
  {
    id: 'design-1',
    title: 'htmlFor on a label that wraps its control is skipped',
    origin: RULES,
    jsx: '<label htmlFor="q">Query <input id="q" /></label>',
    expect: [['TextLiteral', '']],
  },
  {
    id: 'design-2',
    title: 'text inside style is not rendered text',
    origin: RULES,
    jsx: '<style>.a {"{"} color: red {"}"}</style>',
    expect: [],
  },
  {
    id: 'design-3',
    title: 'text inside script is not rendered text',
    origin: RULES,
    jsx: '<script>window.ready = true</script>',
    expect: [],
  },
  {
    id: 'design-4',
    title:
      'a role equal to the implicit role is skipped, and the button still swaps',
    origin: RULES,
    jsx: '<button role="button">Save</button>',
    expect: [
      ['ElementRole', '<span role="button">Save</span>'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'design-5',
    title: 'a link role on an a with href is implicit',
    origin: RULES,
    jsx: '<a href="/x" role="link">X</a>',
    expect: [
      ['ElementRole', '<span role="link">X</span>'],
      ['TextLiteral', ''],
      ['UrlAttribute', 'href=""'],
    ],
  },
  {
    id: 'design-6',
    title: 'a link role on an a without href is removed',
    origin: RULES,
    jsx: '<a role="link" tabIndex={0}>X</a>',
    expect: [
      ['ElementRole', 'role={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'design-7',
    title:
      'implicit roles of landmarks, lists and headings are skipped; a context-dependent one is removed',
    origin: RULES,
    jsx: '<div><nav role="navigation" /><aside role="complementary" /><ol role="list"><li role="listitem" /></ol><h2 role="heading" /><header role="banner" /></div>',
    expect: [['ElementRole', 'role={undefined}']],
  },
  {
    id: 'design-8',
    title: 'a string state value is flipped',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: '<div role="tab" aria-selected="true" aria-expanded="false">Tab</div>',
    expect: [
      ['ElementRole', 'role={undefined}'],
      ['StateAttribute', 'aria-selected="false"'],
      ['StateAttribute', 'aria-expanded="true"'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'design-9',
    title:
      'aria-hidden on an i or img icon is skipped; hidden on an svg is not',
    origin: 'design:Operators in the first release, HiddenAttribute',
    jsx: '<p><i className="icon" aria-hidden="true" /><img src="x.png" aria-hidden={hide} /><svg hidden /></p>',
    expect: [['HiddenAttribute', 'hidden={undefined}']],
  },
  {
    id: 'design-10',
    title:
      'a JSX entity in an emptied attribute is decoded in the instrumented original',
    origin: 'docs/design/playwright-mutators-opus.md:189',
    jsx: '<img alt="Fish &amp; Chips" />',
    expect: [['LabelAttribute', 'alt=""']],
    instrumented: '"Fish & Chips"',
  },
  {
    id: 'design-11',
    title:
      'a guard and a ternary inside an attribute value: the guard is removed, the ternary is left alone',
    origin: 'design:Tradeoffs accepted (candidate-opus), ConditionalElement',
    jsx: '<Card icon={busy && <Spinner />} badge={busy ? <Dot /> : null} />',
    expect: [['ConditionalElement', '<Spinner />']],
  },
  {
    id: 'design-12',
    title:
      'a function declared in the file but referenced twice keeps its handler mutants',
    origin: 'design:Operators in the first release, EventHandler',
    setup: 'function save() {}\nexport const again = save;',
    jsx: '<form onSubmit={save}></form>',
    expect: [['EventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'design-13',
    title:
      'a let handler referenced once keeps its handler mutant, as only a const or a declaration is skipped',
    origin: 'design:Operators in the first release, EventHandler',
    setup: 'let save = () => {};',
    jsx: '<form onSubmit={save}></form>',
    expect: [['EventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'design-14',
    title:
      'implicit roles of status, separator, paragraph, group, option, progressbar and textbox are skipped',
    origin: RULES,
    jsx: '<div><output role="status" /><hr role="separator" /><p role="paragraph" /><fieldset role="group" /><option role="option" /><progress role="progressbar" /><textarea role="textbox" /></div>',
    expect: [],
  },
  {
    id: 'tldraw-1',
    title:
      "a 'true'/'false' ternary state is flipped in each branch, not negated to a constant",
    origin:
      'tldraw@12921f6d3:packages/tldraw/src/lib/ui/components/primitives/menus/TldrawUiMenuItem.tsx:233',
    jsx: "<div aria-pressed={isSelected ? 'true' : 'false'} />",
    expect: [
      ['StateAttribute', 'aria-pressed={isSelected ? "false" : "true"}'],
    ],
  },
  {
    id: 'tldraw-2',
    title:
      'a nested ternary state keeps its undefined branch and flips the string branches',
    origin:
      'tldraw@12921f6d3:packages/tldraw/src/lib/ui/components/primitives/menus/TldrawUiMenuItem.tsx:173',
    jsx: "<div aria-pressed={isSelected === undefined ? undefined : isSelected ? 'true' : 'false'} />",
    expect: [
      [
        'StateAttribute',
        'aria-pressed={isSelected === undefined ? undefined : isSelected ? "false" : "true"}',
      ],
    ],
  },
  {
    id: 'design-15',
    title:
      'a String() or template-literal state gets no negation, which would be a constant false',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: '<div><div aria-expanded={String(open)} /><div aria-checked={`${checked}`} /></div>',
    expect: [],
  },
  {
    id: 'design-16',
    title: 'a boolean state expression is negated',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: '<div aria-expanded={open} aria-selected={tab === current} />',
    expect: [
      ['StateAttribute', 'aria-expanded={!open}'],
      ['StateAttribute', 'aria-selected={!(tab === current)}'],
    ],
  },
  {
    id: 'design-17',
    title: 'a boolean-literal ternary state flips each branch',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: '<div aria-pressed={on ? true : false} />',
    expect: [['StateAttribute', 'aria-pressed={on ? false : true}']],
  },
  {
    id: 'design-18',
    title:
      'a .toString() state gets no negation; another method call is negated',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: '<div aria-expanded={open.toString()} aria-checked={state.get()} aria-selected={isOpen()} />',
    expect: [
      ['StateAttribute', 'aria-checked={!state.get()}'],
      ['StateAttribute', 'aria-selected={!isOpen()}'],
    ],
  },
  {
    id: 'design-19',
    title:
      'a ternary state with no negatable branch gets no mutant; one with a single negatable branch flips only that one',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: "<div><div aria-pressed={c ? undefined : String(x)} /><div aria-expanded={c ? 'true' : undefined} /></div>",
    expect: [['StateAttribute', 'aria-expanded={c ? "false" : undefined}']],
  },
  {
    id: 'design-20',
    title: 'a rendered value among the children of a fragment is removed',
    origin: 'design:Operators in the first release, ChildExpression',
    jsx: '<>{user.name}</>',
    expect: [['ChildExpression', 'null']],
  },
  {
    id: 'design-21',
    title:
      'a member-named element is never swapped to a span, and its role has no implicit equal',
    origin: 'design:Operators in the first release, ElementRole',
    jsx: '<div><UI.Button>Go</UI.Button><UI.Dialog role="dialog" /></div>',
    expect: [
      ['ElementRole', 'role={undefined}'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'design-22',
    title: 'an href on an element other than a is not swapped to a span',
    origin: 'design:Operators in the first release, ElementRole',
    jsx: '<area href="/x" />',
    expect: [['UrlAttribute', 'href=""']],
  },
  {
    id: 'design-23',
    title:
      'a guard whose test is an ===, < or >= comparison is left to the built-in ConditionalExpression',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: '<div>{a == b && <p />}{a != b && <p />}{a === b && <p />}{a < b && <p />}{a <= b && <p />}{a >= b && <p />}</div>',
    expect: [],
  },
  {
    id: 'design-24',
    title: 'a filter call among the children is left to ListExpression',
    origin: 'design:Operators in the first release, ChildExpression',
    jsx: '<ul>{items.filter(visible)}{groups.flatMap(rows)}</ul>',
    expect: [],
  },
  {
    id: 'design-25',
    title:
      'htmlFor on a label that wraps a select, or an input inside a fragment, is skipped',
    origin: 'design:Operators in the first release, LabelAttribute',
    jsx: '<div><label htmlFor="a"><select /></label><label htmlFor="b"><><input /></></label><label htmlFor="c"><textarea /></label></div>',
    expect: [],
  },
  {
    id: 'design-29',
    title: 'htmlFor on a label whose children hold no form control is emptied',
    origin: 'design:Operators in the first release, LabelAttribute',
    jsx: '<label htmlFor="d"><span>Name</span></label>',
    expect: [
      ['LabelAttribute', 'htmlFor=""'],
      ['TextLiteral', ''],
    ],
  },
  {
    id: 'design-30',
    title:
      'a negated state holds no built-in mutant of its own expression in the instrumented file',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: '<div aria-expanded={isOpen(a && b)} />',
    expect: [['StateAttribute', 'aria-expanded={!isOpen(a && b)}']],
    instrumented: '? !isOpen(a && b) : (stryCov_9fa48(',
  },
  {
    id: 'design-31',
    title:
      'a flipped ternary state holds no built-in mutant of its test in the instrumented file',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: "<div aria-pressed={isOpen(a && b) ? 'true' : 'false'} />",
    expect: [
      ['StateAttribute', 'aria-pressed={isOpen(a && b) ? "false" : "true"}'],
    ],
    instrumented: '? isOpen(a && b) ? "false" : "true" : (stryCov_9fa48(',
  },
  {
    id: 'design-32',
    title:
      'a ternary state keeps its unflipped consequent free of built-in mutants in the instrumented file',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: "<div aria-expanded={c ? String(a && b) : 'true'} />",
    expect: [
      ['StateAttribute', 'aria-expanded={c ? String(a && b) : "false"}'],
    ],
    instrumented: '? c ? String(a && b) : "false" : (stryCov_9fa48(',
  },
  {
    id: 'design-33',
    title:
      'a ternary state keeps its unflipped alternate free of built-in mutants in the instrumented file',
    origin: 'design:Operators in the first release, StateAttribute',
    jsx: "<div aria-expanded={c ? 'true' : String(a && b)} />",
    expect: [
      ['StateAttribute', 'aria-expanded={c ? "false" : String(a && b)}'],
    ],
    instrumented: '? c ? "false" : String(a && b) : (stryCov_9fa48(',
  },
  {
    id: 'design-34',
    title:
      'a guard whose test is a ?? expression is removed, as built-in ConditionalExpression leaves ?? alone',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: '<div>{(a ?? b) && <p />}</div>',
    expect: [['ConditionalElement', '<p />']],
  },
  {
    id: 'design-35',
    title:
      'a label other than htmlFor, and htmlFor on an element other than label, are emptied though a control is inside',
    origin: 'design:Operators in the first release, LabelAttribute',
    jsx: '<div><div aria-label="Search"><input /></div><output htmlFor="a"><input /></output><label title="Name"><input /></label></div>',
    expect: [
      ['LabelAttribute', 'aria-label=""'],
      ['LabelAttribute', 'htmlFor=""'],
      ['LabelAttribute', 'title=""'],
    ],
  },
  {
    id: 'design-36',
    title:
      'an attribute with on inside its name, not at its start, is no handler',
    origin: 'design:Operators in the first release, EventHandler',
    jsx: '<Card buttonColor={color} />',
    expect: [],
  },
  {
    id: 'design-37',
    title: 'an || fallback is not a guard',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: '<div>{fallback || <p />}</div>',
    expect: [],
  },
  {
    id: 'design-38',
    title: 'a ternary with one JSX branch switches to either branch',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: "<div>{open ? <p /> : 'none'}</div>",
    expect: [
      ['ConditionalElement', '<p />'],
      ['ConditionalElement', "'none'"],
    ],
  },
  {
    id: 'design-39',
    title:
      'a removed guard holds no built-in mutant of its element in the instrumented file',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: '<div>{open && <p>{a + b}</p>}</div>',
    expect: [['ConditionalElement', '<p>{a + b}</p>']],
    instrumented: '? <p>{a + b}</p> : stryMutAct_9fa48(',
  },
  {
    id: 'design-40',
    title:
      'a ternary switched to its consequent holds no built-in mutant of it in the instrumented file',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: '<div>{open ? <i>{c + d}</i> : <b />}</div>',
    expect: [
      ['ConditionalElement', '<i>{c + d}</i>'],
      ['ConditionalElement', '<b />'],
    ],
    instrumented: '? <i>{c + d}</i> : (stryCov_9fa48(',
  },
  {
    id: 'design-41',
    title:
      'a ternary switched to its alternate holds no built-in mutant of it in the instrumented file',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: '<div>{open ? <i /> : <b>{e + f}</b>}</div>',
    expect: [
      ['ConditionalElement', '<i />'],
      ['ConditionalElement', '<b>{e + f}</b>'],
    ],
    instrumented: '? <b>{e + f}</b> : stryMutAct_9fa48(',
  },
  {
    id: 'design-42',
    title:
      'action, readOnly and an aria-hidden expression are mutated; aria-hidden on a member-named element is not skipped',
    origin: 'design:Operators in the first release',
    jsx: '<form action="/save"><input readOnly /><div aria-hidden={hide} /><UI.Icon aria-hidden="true" /></form>',
    expect: [
      ['UrlAttribute', 'action=""'],
      ['DisabledAttribute', 'readOnly={undefined}'],
      ['HiddenAttribute', 'aria-hidden={false}'],
      ['HiddenAttribute', 'aria-hidden={undefined}'],
    ],
  },
  {
    id: 'design-26',
    title:
      'a guard or a ternary whose branches are not JSX gives no ConditionalElement mutant',
    origin: 'design:Operators in the first release, ConditionalElement',
    jsx: "<div>{open && label}{open ? 'a' : 'b'}</div>",
    expect: [],
  },
  {
    id: 'design-27',
    title:
      'a const handler that is not a function keeps its mutant; a const function expression is skipped',
    origin: 'design:Operators in the first release, EventHandler',
    setup: 'const onSave = makeHandler();\nconst onReset = function () {};',
    jsx: '<form onSubmit={onSave} onReset={onReset}></form>',
    expect: [['EventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'design-28',
    title:
      "a role equal to the tag's implicit role in Playwright's getByRole is skipped, for every such tag",
    origin: RULES,
    jsx:
      '<div><article role="article" /><aside role="complementary" /><blockquote role="blockquote" />' +
      '<button role="button" /><caption role="caption" /><code role="code" /><datalist role="listbox" />' +
      '<dd role="definition" /><del role="deletion" /><details role="group" /><dfn role="term" />' +
      '<dialog role="dialog" /><dt role="term" /><em role="emphasis" /><fieldset role="group" />' +
      '<figure role="figure" /><h1 role="heading" /><h2 role="heading" /><h3 role="heading" />' +
      '<h4 role="heading" /><h5 role="heading" /><h6 role="heading" /><hr role="separator" />' +
      '<html role="document" /><ins role="insertion" /><li role="listitem" /><main role="main" />' +
      '<mark role="mark" /><math role="math" /><menu role="list" /><meter role="meter" />' +
      '<nav role="navigation" /><ol role="list" /><optgroup role="group" /><option role="option" />' +
      '<output role="status" /><p role="paragraph" /><progress role="progressbar" />' +
      '<search role="search" /><strong role="strong" /><sub role="subscript" />' +
      '<sup role="superscript" /><svg role="img" /><table role="table" /><tbody role="rowgroup" />' +
      '<textarea role="textbox" /><tfoot role="rowgroup" /><thead role="rowgroup" />' +
      '<time role="time" /><tr role="row" /><ul role="list" /></div>',
    expect: [['ElementRole', '<span role="button" />']],
  },
];
