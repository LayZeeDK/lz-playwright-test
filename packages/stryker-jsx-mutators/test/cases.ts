// Synthetic UI shapes from the open-source repos the runner was exercised on, as JSX, with the UI mutants the
// design (docs/design/playwright-mutators.md) says each gives. An empty expect is a must-not-generate case. The
// mined rows and their transcription notes are in spikes/ui-mutator-cases/.
import type { MutatorName } from '../src/mutators.ts';

export interface Case {
  readonly id: string;
  readonly title: string;
  // `<repo>@<commit>:<path>:<line>[,<line>]`, the shape this case reproduces; `design:<section>` for a design rule.
  readonly origin: string;
  // Module code before the component, for shapes that need a same-file declaration.
  readonly setup?: string;
  // One JSX expression; free identifiers stand for props.
  readonly jsx: string;
  readonly expect: readonly (readonly [
    mutator: MutatorName,
    replacement: string,
  ])[];
  // Text the instrumented file must contain, for a rule about placement rather than about the mutants.
  readonly instrumented?: string;
}

const realworldOrigin = 'realworld@bc7158d:';
const yetiOrigin = 'ngx-yeti@87d4377:apps/yeti-app/src/app/fixtures/';
const analogOrigin = 'analog@a377078ec:';
const helloWorldOrigin = 'stryker-playwright-hello-world@fa6dd64:';
const demoOrigin = 'stryker-playwright-runner@f00806e:apps/demo-app/src/app/';
const rulesOrigin = 'design:Rules the synthetic cases settled';
const release = 'design:Mutators in the first release';

export const cases: readonly Case[] = [
  {
    id: 'realworld-1',
    title: 'a button with text and a prop handler loses both',
    origin: `${realworldOrigin}libs/settings/feature-settings/src/settings.component.html:67`,
    jsx: '<button className="btn btn-outline-danger" onClick={logout}>Or click here to logout.</button>',
    expect: [
      [
        'LzJsxElementRole',
        '<span className="btn btn-outline-danger" onClick={logout}>Or click here to logout.</span>',
      ],
      ['LzJsxEventHandler', 'onClick={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'realworld-2',
    title: 'a plain-string placeholder is emptied',
    origin: `${realworldOrigin}libs/auth/feature-auth/src/login/login.component.html:18`,
    jsx: '<input type="email" id="email" placeholder="Email" />',
    expect: [['LzJsxLabelAttribute', 'placeholder=""']],
  },
  {
    id: 'realworld-3',
    title: 'a form submit handler from props is removed',
    origin: `${realworldOrigin}libs/auth/feature-auth/src/login/login.component.html:12`,
    jsx: '<form onSubmit={onSubmit}></form>',
    expect: [['LzJsxEventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'realworld-4',
    title: 'a delete button with a prop handler loses handler, text and role',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article-meta/article-meta.component.html:17`,
    jsx: '<button className="btn btn-sm btn-outline-danger" onClick={deleteArticle}>Delete Article</button>',
    expect: [
      [
        'LzJsxElementRole',
        '<span className="btn btn-sm btn-outline-danger" onClick={deleteArticle}>Delete Article</span>',
      ],
      ['LzJsxEventHandler', 'onClick={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'realworld-5',
    title: 'an inline arrow handler is left to ArrowFunction',
    origin: `${realworldOrigin}libs/ui/components/src/pager/pager.component.html:7`,
    jsx: '<li onClick={() => setPage(pageNumber)}></li>',
    expect: [],
  },
  {
    id: 'realworld-6',
    title: 'a same-file handler referenced once is skipped',
    origin: `${realworldOrigin}libs/settings/feature-settings/src/settings.component.html:67`,
    setup: 'function logout() {\n  store.logout();\n}',
    jsx: '<button onClick={logout}>Logout</button>',
    expect: [
      ['LzJsxElementRole', '<span onClick={logout}>Logout</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'realworld-7',
    title: 'a ternary with a unary test forces each branch',
    origin: `${realworldOrigin}apps/conduit/src/app/layout/navbar/navbar.component.html:5`,
    jsx: '<nav>{!isLoggedIn ? <GuestNav /> : <MemberNav />}</nav>',
    expect: [
      ['LzJsxConditionalElement', '<GuestNav />'],
      ['LzJsxConditionalElement', '<MemberNav />'],
    ],
  },
  {
    id: 'realworld-8',
    title: 'an identifier guard is removed',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article.component.html:1`,
    jsx: '<main>{article && <ArticlePage article={article} />}</main>',
    expect: [['LzJsxConditionalElement', '<ArticlePage article={article} />']],
  },
  {
    id: 'realworld-9',
    title: 'a comparison guard is left to ConditionalExpression',
    origin: `${realworldOrigin}libs/core/forms/src/lib/list-errors/list-errors.component.html:1`,
    jsx: '<div>{errors.length > 0 && <ul className="error-messages" />}</div>',
    expect: [],
  },
  {
    id: 'realworld-10',
    title: 'a link with a computed href is emptied and swapped',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article-meta/article-meta.component.html:2`,
    jsx: '<a data-testid="article-author" href={\'/profile/\' + username}></a>',
    expect: [
      ['LzJsxElementRole', '<span data-testid="article-author"></span>'],
      ['LzJsxUrlAttribute', 'href=""'],
    ],
  },
  {
    id: 'realworld-11',
    title: 'a nav link loses href, role and text',
    origin: `${realworldOrigin}apps/conduit/src/app/layout/navbar/navbar.component.html:11`,
    jsx: '<a className="nav-link" href="/login">Sign in</a>',
    expect: [
      ['LzJsxElementRole', '<span className="nav-link">Sign in</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'realworld-12+13',
    title:
      'a submit button is swapped for a span and its text is emptied; its logical disabled expression is left to the built-in ConditionalExpression',
    origin: `${realworldOrigin}libs/auth/feature-auth/src/login/login.component.html:33,36`,
    jsx: '<button data-testid="sign-in" disabled={form.invalid || form.pending} type="submit">Sign in</button>',
    expect: [
      ['LzJsxElementRole', '<span data-testid="sign-in">Sign in</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'realworld-14',
    title:
      'a comparison hidden expression is not forced off; the built-in ConditionalExpression already gives {false}',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article-comment/article-comment.component.html:16`,
    jsx: '<span className="mod-options" hidden={currentUser.username !== comment.author.username}></span>',
    expect: [],
  },
  {
    id: 'realworld-15',
    title: 'a negated hidden expression is forced off',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article-meta/article-meta.component.html:12`,
    jsx: '<span hidden={!canModify}></span>',
    expect: [['LzJsxHiddenAttribute', 'hidden={false}']],
  },
  {
    id: 'realworld-16',
    title: 'aria-hidden with a boolean literal is left to BooleanLiteral',
    origin: `${realworldOrigin}libs/ui/components/src/avatar/avatar.component.html:4`,
    jsx: '<span className="avatar fallback" aria-hidden={true}>{initials}</span>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'realworld-17',
    title: 'a member expression child is emptied',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article.component.html:5`,
    jsx: '<h1 data-testid="article-title">{article.title}</h1>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'realworld-18',
    title: 'parentheses around a child are not text',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article-meta/article-meta.component.html:46`,
    jsx: '<span className="counter">({article.favoritesCount})</span>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'realworld-19',
    title: 'non-breaking-space entities are not text',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article-meta/article-meta.component.html:35`,
    jsx: '<p><i />&nbsp;&nbsp;<i /></p>',
    expect: [],
  },
  {
    id: 'realworld-20',
    title: 'a sentence with two links gives text, url and role mutants',
    origin: `${realworldOrigin}libs/articles/feature-article/src/article.component.html:43`,
    jsx: '<><a href="/login">Sign in</a> or <a href="/register">sign up</a> to add comments on this article.</>',
    expect: [
      ['LzJsxElementRole', '<span>Sign in</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxTextLiteral', ''],
      ['LzJsxElementRole', '<span>sign up</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'realworld-21',
    title: 'a bound alt is emptied',
    origin: `${realworldOrigin}libs/ui/components/src/avatar/avatar.component.html:2`,
    jsx: '<img src={src} alt={username} />',
    expect: [['LzJsxLabelAttribute', 'alt=""']],
  },
  {
    id: 'realworld-22',
    title: 'an a without href keeps its tag',
    origin: `${realworldOrigin}libs/ui/components/src/pager/pager.component.html:9`,
    jsx: '<a data-testid="pagination-link" className="page-link">{pageNumber}</a>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'ngx-yeti-1',
    title:
      'a negated disabled expression is forced off; the inline handler is skipped',
    origin: `${yetiOrigin}button-fixture.ts:21`,
    jsx: '<button type="button" disabled={!live} onClick={() => setLive(false)}>Remove the live buttons</button>',
    expect: [
      [
        'LzJsxElementRole',
        '<span onClick={() => setLive(false)}>Remove the live buttons</span>',
      ],
      ['LzJsxDisabledAttribute', 'disabled={false}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-2',
    title: 'an identifier guard around a form is removed',
    origin: `${yetiOrigin}button-fixture.ts:26`,
    jsx: '<div>{live && <form id="button-form"></form>}</div>',
    expect: [['LzJsxConditionalElement', '<form id="button-form"></form>']],
  },
  {
    id: 'ngx-yeti-3',
    title:
      'a strict-inequality guard is skipped; the link inside still mutates',
    origin: `${yetiOrigin}fragment-links-fixture.ts:38`,
    jsx: '<div>{page !== null && <a href="../two">Open page two</a>}</div>',
    expect: [
      ['LzJsxElementRole', '<span>Open page two</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-4',
    title: 'a bare disabled on an a without href is forced off',
    origin: `${yetiOrigin}button-fixture.ts:68`,
    jsx: '<a id="previous" disabled>Previous</a>',
    expect: [
      ['LzJsxDisabledAttribute', 'disabled={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-5',
    title: 'a conditional href and a disabled expression',
    origin: `${yetiOrigin}button-fixture.ts:61`,
    jsx: '<a id="next" disabled={last} href={last ? null : \'/replay\'}>Next</a>',
    expect: [
      ['LzJsxElementRole', '<span id="next">Next</span>'],
      ['LzJsxDisabledAttribute', 'disabled={false}'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-6',
    title: 'a router link loses href, role and text',
    origin: `${yetiOrigin}button-fixture.ts:24`,
    jsx: '<a href="/replay">Leave for a page without buttons</a>',
    expect: [
      ['LzJsxElementRole', '<span>Leave for a page without buttons</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-7',
    title: 'a fragment link loses href, role and text',
    origin: `${yetiOrigin}button-fixture.ts:92`,
    jsx: '<a id="contact-link" href="#contact">Contact us</a>',
    expect: [
      ['LzJsxElementRole', '<span id="contact-link">Contact us</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-8',
    title: 'a group aria-label is emptied',
    origin: `${yetiOrigin}buttons-fixture.ts:50`,
    jsx: '<div aria-label="Text style"></div>',
    expect: [['LzJsxLabelAttribute', 'aria-label=""']],
  },
  {
    id: 'ngx-yeti-9',
    title:
      'an svg keeps its img role, as Playwright gives svg that role, and loses its aria-label',
    origin: `${yetiOrigin}icon-fixture.ts:36`,
    jsx: '<svg role="img" aria-label="Warning" viewBox="0 0 24 24"></svg>',
    expect: [['LzJsxLabelAttribute', 'aria-label=""']],
  },
  {
    id: 'ngx-yeti-10',
    title: 'a status role and its aria-label are removed',
    origin: `${yetiOrigin}spinner-fixture.ts:23`,
    jsx: '<span id="loading-spinner" role="status" aria-label="Loading"></span>',
    expect: [
      ['LzJsxElementRole', 'role={undefined}'],
      ['LzJsxLabelAttribute', 'aria-label=""'],
    ],
  },
  {
    id: 'ngx-yeti-11',
    title: 'a plain-string alt is emptied',
    origin: `${yetiOrigin}card-fixture.ts:36`,
    jsx: '<img src="trail.svg" width="1600" height="900" alt="A mountain trail at dawn" />',
    expect: [['LzJsxLabelAttribute', 'alt=""']],
  },
  {
    id: 'ngx-yeti-12',
    title: 'an iframe title is emptied',
    origin: `${yetiOrigin}frame-fixture.ts:44`,
    jsx: '<iframe title="Trail notes" srcDoc="<p>Six miles and one summit.</p>"></iframe>',
    expect: [['LzJsxLabelAttribute', 'title=""']],
  },
  {
    id: 'ngx-yeti-13',
    title: 'aria-labelledby is emptied',
    origin: `${yetiOrigin}fragment-links-fixture.ts:48`,
    jsx: '<svg aria-labelledby="svg-link-text" height="24" width="160"></svg>',
    expect: [['LzJsxLabelAttribute', 'aria-labelledby=""']],
  },
  {
    id: 'ngx-yeti-14',
    title: 'aria-hidden on a decorative svg is skipped',
    origin: `${yetiOrigin}button-fixture.ts:82`,
    jsx: '<svg aria-hidden="true" viewBox="0 0 24 24"></svg>',
    expect: [],
  },
  {
    id: 'ngx-yeti-15',
    title: 'aria-pressed is negated; a const arrow referenced once is skipped',
    origin: `${yetiOrigin}button-fixture.ts:29`,
    setup: 'const pressBold = () => {\n  setBold((b) => !b);\n};',
    jsx: '<button id="bold" type="button" aria-pressed={bold} onClick={pressBold}>Bold</button>',
    expect: [
      [
        'LzJsxElementRole',
        '<span id="bold" aria-pressed={bold} onClick={pressBold}>Bold</span>',
      ],
      ['LzJsxStateAttribute', 'aria-pressed={!bold}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-16',
    title: 'a const arrow referenced twice is removed at each reference',
    origin: `${yetiOrigin}button-fixture.ts:29`,
    setup: 'const pressBold = () => {\n  setBold((b) => !b);\n};',
    jsx: '<div><button id="bold" type="button" onClick={pressBold}>Bold</button><button id="bold-key" type="button" onClick={pressBold}>Bold</button></div>',
    expect: [
      ['LzJsxElementRole', '<span id="bold" onClick={pressBold}>Bold</span>'],
      ['LzJsxEventHandler', 'onClick={undefined}'],
      ['LzJsxTextLiteral', ''],
      [
        'LzJsxElementRole',
        '<span id="bold-key" onClick={pressBold}>Bold</span>',
      ],
      ['LzJsxEventHandler', 'onClick={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-17',
    title: 'an output child is emptied',
    origin: `${yetiOrigin}button-fixture.ts:39`,
    jsx: '<output id="bold-presses">{presses}</output>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'ngx-yeti-18',
    title: 'aria-disabled is forced off and aria-busy is untouched',
    origin: `${yetiOrigin}button-fixture.ts:69`,
    jsx: '<button id="busy" type="button" aria-busy={waiting} aria-disabled={waiting}>Saving</button>',
    expect: [
      [
        'LzJsxElementRole',
        '<span id="busy" aria-busy={waiting} aria-disabled={waiting}>Saving</span>',
      ],
      ['LzJsxDisabledAttribute', 'aria-disabled={false}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-19',
    title:
      'a list role equal to the implicit role is kept; each item text is emptied',
    origin: `${yetiOrigin}cluster-fixture.ts:24`,
    jsx: '<ul id="tags-cluster" role="list"><li>layout</li><li>intrinsic</li></ul>',
    expect: [
      ['LzJsxTextLiteral', ''],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'ngx-yeti-20',
    title: 'a plain button is swapped for a span',
    origin: `${yetiOrigin}button-fixture.ts:28`,
    jsx: '<button id="save" type="button">Save</button>',
    expect: [
      ['LzJsxElementRole', '<span id="save">Save</span>'],
      ['LzJsxTextLiteral', ''],
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
    origin: `${analogOrigin}libs/top-bar/src/lib/top-bar/template.html:16`,
    jsx: '<a href="/"><h1>My Store</h1></a>',
    expect: [
      ['LzJsxElementRole', '<span><h1>My Store</h1></span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-2',
    title: 'a link with an icon ligature and text gives two text mutants',
    origin: `${analogOrigin}libs/top-bar/src/lib/top-bar/template.html:20`,
    jsx: '<a href="/cart" className="button fancy-button"><i className="material-icons">shopping_cart</i>Checkout</a>',
    expect: [
      [
        'LzJsxElementRole',
        '<span className="button fancy-button"><i className="material-icons">shopping_cart</i>Checkout</span>',
      ],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-3',
    title:
      'a bound title is emptied; a template-literal href is left to StringLiteral',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/(home).page.ts:22`,
    jsx: "<a title={product.name + ' details'} href={`/products/${product.id}`}>{product.name}</a>",
    expect: [
      [
        'LzJsxElementRole',
        "<span title={product.name + ' details'}>{product.name}</span>",
      ],
      ['LzJsxChildExpression', 'null'],
      ['LzJsxLabelAttribute', 'title=""'],
    ],
  },
  {
    id: 'analog-4',
    title: 'a member-expression guard around text and a child',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/(home).page.ts:32`,
    jsx: '<div>{product.description && <p>Description: {product.description}</p>}</div>',
    expect: [
      ['LzJsxConditionalElement', '<p>Description: {product.description}</p>'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxChildExpression', 'null'],
    ],
  },
  {
    id: 'analog-5',
    title: 'a same-file const arrow referenced once is skipped',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/(home).page.ts:35`,
    setup:
      "const share = () => {\n  window.alert('The product has been shared!');\n};",
    jsx: '<button type="button" onClick={share}>Share</button>',
    expect: [
      ['LzJsxElementRole', '<span onClick={share}>Share</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-6',
    title: 'an imported handler is removed',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/(home).page.ts:35`,
    setup: "import { share } from './share';",
    jsx: '<button type="button" onClick={share}>Share</button>',
    expect: [
      ['LzJsxElementRole', '<span onClick={share}>Share</span>'],
      ['LzJsxEventHandler', 'onClick={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-7',
    title: 'a same-file handler passed once to a component is skipped',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/(home).page.ts:36`,
    setup:
      "const onNotify = () => {\n  window.alert('You will be notified when the product goes on sale');\n};",
    jsx: '<ProductAlerts product={product} onNotify={onNotify} />',
    expect: [],
  },
  {
    id: 'analog-8',
    title: 'a logical guard is skipped; the button inside still mutates',
    origin: `${analogOrigin}apps/analog-app/src/app/product-alerts/product-alerts.component.ts:7`,
    jsx: '<div>{product() && product()!.price > 700 && (<p><button type="button" onClick={() => notify.emit()}>Notify Me</button></p>)}</div>',
    expect: [
      [
        'LzJsxElementRole',
        '<span onClick={() => notify.emit()}>Notify Me</span>',
      ],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-9',
    title: 'a call-expression ternary forces each branch',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/newsletter.page.ts:20`,
    jsx: '<div>{signedUpEmail() ? <div id="signup-message">Thanks for signing up, {signedUpEmail()}!</div> : <form method="post"><button type="submit">Submit</button></form>}</div>',
    expect: [
      [
        'LzJsxConditionalElement',
        '<div id="signup-message">Thanks for signing up, {signedUpEmail()}!</div>',
      ],
      [
        'LzJsxConditionalElement',
        '<form method="post"><button type="submit">Submit</button></form>',
      ],
      ['LzJsxTextLiteral', ''],
      ['LzJsxChildExpression', 'null'],
      ['LzJsxElementRole', '<span>Submit</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-10',
    title: 'an optional-chain guard and child',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/newsletter.page.ts:40`,
    jsx: '<div>{errors()?.email && <p>{errors()?.email}</p>}</div>',
    expect: [
      ['LzJsxConditionalElement', '<p>{errors()?.email}</p>'],
      ['LzJsxChildExpression', 'null'],
    ],
  },
  {
    id: 'analog-11',
    title: 'a same-file submit handler referenced once is skipped',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/cart.page.ts:25`,
    setup: 'const onSubmit = () => {\n  clearCart();\n};',
    jsx: '<form onSubmit={onSubmit}></form>',
    expect: [],
  },
  {
    id: 'analog-12',
    title: 'a member-expression submit handler is removed',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/cart.page.ts:25`,
    jsx: '<form onSubmit={props.onSubmit}></form>',
    expect: [['LzJsxEventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'analog-13',
    title: 'a label loses htmlFor and its padded text',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/cart.page.ts:27`,
    jsx: '<div><label htmlFor="name"> Name </label><input id="name" type="text" /></div>',
    expect: [
      ['LzJsxLabelAttribute', 'htmlFor=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-14',
    title: 'a label whose htmlFor points at no element still mutates',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/newsletter.page.ts:33`,
    jsx: '<div><label htmlFor="email"> Email </label><input type="email" name="email" /></div>',
    expect: [
      ['LzJsxLabelAttribute', 'htmlFor=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-15',
    title: 'a submit button keeps its type',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/cart.page.ts:36`,
    jsx: '<button className="button" type="submit">Purchase</button>',
    expect: [
      ['LzJsxElementRole', '<span className="button">Purchase</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-16',
    title: 'trailing whitespace text is not text',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/cart.page.ts:19`,
    jsx: '<div className="cart-item"><span>{item.name} </span></div>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'analog-17',
    title: 'an em dash between two children is not text',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/server-functions.page.ts:24`,
    jsx: '<li>{p.name} — {p.price}</li>',
    expect: [
      ['LzJsxChildExpression', 'null'],
      ['LzJsxChildExpression', 'null'],
    ],
  },
  {
    id: 'analog-18',
    title: 'a heading text is emptied',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/products.[productId].page.ts:15`,
    jsx: '<h2>Product Details</h2>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'analog-19',
    title: 'an identifier guard around a details block',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/products.[productId].page.ts:17`,
    jsx: '<section>{product && (<div><h3>{product.name}</h3><p>{product.description}</p><button type="button" onClick={() => addToCart(product)}>Buy</button></div>)}</section>',
    expect: [
      [
        'LzJsxConditionalElement',
        '<div><h3>{product.name}</h3><p>{product.description}</p><button type="button" onClick={() => addToCart(product)}>Buy</button></div>',
      ],
      ['LzJsxChildExpression', 'null'],
      ['LzJsxChildExpression', 'null'],
      [
        'LzJsxElementRole',
        '<span onClick={() => addToCart(product)}>Buy</span>',
      ],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'analog-20',
    title: 'a map child is left to the later ListExpression',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/(home).page.ts:19`,
    jsx: '<div>{data().products.map((product) => <div key={product.id}></div>)}</div>',
    expect: [],
  },
  {
    id: 'analog-21',
    title: 'an identifier ternary between two component branches',
    origin: `${analogOrigin}apps/analog-app/src/stories/header.component.ts:38`,
    jsx: '<header>{user ? <div><Button size="small" onClicked={() => logout.emit(event)} label="Log out" /></div> : <div><Button size="small" label="Log in" /></div>}</header>',
    expect: [
      [
        'LzJsxConditionalElement',
        '<div><Button size="small" onClicked={() => logout.emit(event)} label="Log out" /></div>',
      ],
      [
        'LzJsxConditionalElement',
        '<div><Button size="small" label="Log in" /></div>',
      ],
    ],
  },
  {
    id: 'analog-24',
    title: 'a shipping link loses href, role and text',
    origin: `${analogOrigin}apps/analog-app/src/app/pages/cart.page.ts:15`,
    jsx: '<a href="/shipping">Shipping Prices</a>',
    expect: [
      ['LzJsxElementRole', '<span>Shipping Prices</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'hello-1',
    title: 'a heading text is emptied',
    origin: `${helloWorldOrigin}index.html:8`,
    jsx: '<h1>Stryker + Playwright Hello World</h1>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'hello-2+3',
    title: 'a label loses its htmlFor and its text',
    origin: `${helloWorldOrigin}index.html:10`,
    jsx: '<label htmlFor="amount">Betrag</label>',
    expect: [
      ['LzJsxLabelAttribute', 'htmlFor=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'hello-4+5',
    title: 'a button is swapped for a span and its text is emptied',
    origin: `${helloWorldOrigin}index.html:13`,
    jsx: '<button id="btn">Berechnen</button>',
    expect: [
      ['LzJsxElementRole', '<span id="btn">Berechnen</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'hello-6',
    title: 'text before an element keeps its separating space',
    origin: `${helloWorldOrigin}index.html:15`,
    jsx: '<p>Ergebnis: <span id="result"></span></p>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'hello-7',
    title: 'an empty span gives nothing',
    origin: `${helloWorldOrigin}index.html:17`,
    jsx: '<span id="result"></span>',
    expect: [],
  },
  {
    id: 'hello-8',
    title: 'id and type give nothing',
    origin: `${helloWorldOrigin}index.html:11`,
    jsx: '<input id="amount" type="number" />',
    expect: [],
  },
  {
    id: 'hello-9',
    title: 'an inline block-body handler is left to ArrowFunction',
    origin: `${helloWorldOrigin}index.html:23`,
    jsx: '<button id="btn" onClick={() => { setResult(calculatePrice(value)); }}>Berechnen</button>',
    expect: [
      [
        'LzJsxElementRole',
        '<span id="btn" onClick={() => { setResult(calculatePrice(value)); }}>Berechnen</span>',
      ],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'demo-1',
    title: 'a Cart heading text is emptied',
    origin: `${demoOrigin}app.tsx:28`,
    jsx: '<h1>Cart</h1>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-2',
    title: 'an About heading text is emptied',
    origin: `${demoOrigin}app.tsx:69`,
    jsx: '<h1>About</h1>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-3',
    title: 'a router Link to is emptied',
    origin: `${demoOrigin}app.tsx:61`,
    jsx: '<Link to="/about">About</Link>',
    expect: [
      ['LzJsxUrlAttribute', 'to=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'demo-4',
    title: 'a router Link to the root is emptied',
    origin: `${demoOrigin}app.tsx:70`,
    jsx: '<Link to="/">Back to cart</Link>',
    expect: [
      ['LzJsxUrlAttribute', 'to=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'demo-5',
    title: 'a wrapping label text is emptied',
    origin: `${demoOrigin}app.tsx:49`,
    jsx: '<label>Discount code<input value={code} /></label>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-6',
    title: 'a term text is emptied',
    origin: `${demoOrigin}app.tsx:54`,
    jsx: '<dt>Subtotal</dt>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-7',
    title: 'a template-literal aria-label is not a plain string',
    origin: `${demoOrigin}app.tsx:36`,
    jsx: '<input type="number" aria-label={`${line.name} quantity`} />',
    expect: [],
  },
  {
    id: 'demo-8',
    title: 'an inline change handler is left to ArrowFunction',
    origin: `${demoOrigin}app.tsx:38`,
    jsx: '<input onChange={(event) => setQuantity(line.name, Number(event.target.value))} />',
    expect: [],
  },
  {
    id: 'demo-9',
    title: 'a controlled input with an inline handler gives nothing',
    origin: `${demoOrigin}app.tsx:51`,
    jsx: '<input value={code} onChange={(event) => setCode(event.target.value)} />',
    expect: [],
  },
  {
    id: 'demo-10',
    title: 'a formatted call child is emptied',
    origin: `${demoOrigin}app.tsx:44`,
    jsx: '<output>{formatPrice(lineTotal(line))}</output>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'demo-11',
    title: 'a test-id element child is emptied',
    origin: `${demoOrigin}app.tsx:55`,
    jsx: '<dd data-testid="subtotal">{formatPrice(subtotal(lines))}</dd>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'demo-12',
    title: 'a label child and the input aria-label are emptied',
    origin: `${demoOrigin}app.tsx:33`,
    jsx: '<label>{line.name}<input aria-label="x" /></label>',
    expect: [
      ['LzJsxChildExpression', 'null'],
      ['LzJsxLabelAttribute', 'aria-label=""'],
    ],
  },
  {
    id: 'demo-13',
    title: 'a map child is left to the later ListExpression',
    origin: `${demoOrigin}app.tsx:30`,
    jsx: '<ul>{lines.map((line) => (<li key={line.name}>x</li>))}</ul>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-14',
    title: 'a comparison guard is left to ConditionalExpression',
    origin: `${demoOrigin}price-tag.tsx:22`,
    jsx: '<p>{off > 0 && (<s>x</s>)}</p>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-15',
    title: 'a ternary of strings is not a JSX conditional',
    origin: `${demoOrigin}price-tag.tsx:26`,
    jsx: "<strong>{off >= 50 ? 'Half' : `${off}% off`}</strong>",
    expect: [],
  },
  {
    id: 'demo-16',
    title: 'a ternary outside JSX is left to ConditionalExpression',
    origin: `${demoOrigin}price-tag.tsx:17`,
    setup: 'const off = c === undefined ? 0 : percentOff(c);',
    jsx: '<s data-off={off} />',
    expect: [],
  },
  {
    id: 'demo-17',
    title: 'string-literal space children give nothing',
    origin: `${demoOrigin}price-tag.tsx:24`,
    jsx: "<p>{' '}<s>x</s>{' '}</p>",
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'demo-18',
    title: 'a price child is emptied',
    origin: `${demoOrigin}price-tag.tsx:21`,
    jsx: '<span data-testid="price">{formatPrice(cents)}</span>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'demo-19',
    title: 'a component with a numeric prop gives nothing',
    origin: `${demoOrigin}price-tag.story.tsx:3`,
    jsx: '<PriceTag cents={12_00} />',
    expect: [],
  },
  {
    id: 'demo-20',
    title: 'a Route path and element give nothing',
    origin: `${demoOrigin}app.tsx:78`,
    jsx: '<Route path="/" element={<Cart />} />',
    expect: [],
  },
  {
    id: 'design-1',
    title: 'htmlFor on a label that wraps its control is skipped',
    origin: rulesOrigin,
    jsx: '<label htmlFor="q">Query <input id="q" /></label>',
    expect: [['LzJsxTextLiteral', '']],
  },
  {
    id: 'design-2',
    title: 'text inside style is not rendered text',
    origin: rulesOrigin,
    jsx: '<style>.a {"{"} color: red {"}"}</style>',
    expect: [],
  },
  {
    id: 'design-3',
    title: 'text inside script is not rendered text',
    origin: rulesOrigin,
    jsx: '<script>window.ready = true</script>',
    expect: [],
  },
  {
    id: 'design-51',
    title:
      'text inside noscript is not rendered while scripts run, as in a Playwright test unless javaScriptEnabled is false',
    origin: rulesOrigin,
    jsx: '<noscript>Enable JavaScript to use this app</noscript>',
    expect: [],
  },
  {
    id: 'design-4',
    title:
      'a role equal to the implicit role is skipped, and the button still swaps',
    origin: rulesOrigin,
    jsx: '<button role="button">Save</button>',
    expect: [
      ['LzJsxElementRole', '<span role="button">Save</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-5',
    title: 'a link role on an a with href is implicit',
    origin: rulesOrigin,
    jsx: '<a href="/x" role="link">X</a>',
    expect: [
      ['LzJsxElementRole', '<span role="link">X</span>'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxUrlAttribute', 'href=""'],
    ],
  },
  {
    id: 'design-6',
    title: 'a link role on an a without href is removed',
    origin: rulesOrigin,
    jsx: '<a role="link" tabIndex={0}>X</a>',
    expect: [
      ['LzJsxElementRole', 'role={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-7',
    title:
      'implicit roles of landmarks, lists and headings are skipped; a context-dependent one is removed',
    origin: rulesOrigin,
    jsx: '<div><nav role="navigation" /><aside role="complementary" /><ol role="list"><li role="listitem" /></ol><h2 role="heading" /><header role="banner" /></div>',
    expect: [['LzJsxElementRole', 'role={undefined}']],
  },
  {
    id: 'design-8',
    title: 'a string state value is flipped',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div role="tab" aria-selected="true" aria-expanded="false">Tab</div>',
    expect: [
      ['LzJsxElementRole', 'role={undefined}'],
      ['LzJsxStateAttribute', 'aria-selected="false"'],
      ['LzJsxStateAttribute', 'aria-expanded="true"'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-9',
    title:
      'aria-hidden on an i or img icon is skipped; hidden on an svg is not',
    origin: `${release}, LzJsxHiddenAttribute`,
    jsx: '<p><i className="icon" aria-hidden="true" /><img src="x.png" aria-hidden={hide} /><svg hidden /></p>',
    expect: [['LzJsxHiddenAttribute', 'hidden={undefined}']],
  },
  {
    id: 'design-10',
    title:
      'a JSX entity in an emptied attribute is decoded in the instrumented original',
    origin: 'docs/design/playwright-mutators-opus.md:189',
    jsx: '<img alt="Fish &amp; Chips" />',
    expect: [['LzJsxLabelAttribute', 'alt=""']],
    instrumented: '"Fish & Chips"',
  },
  {
    id: 'design-11',
    title:
      'a guard and a ternary inside an attribute value: the guard is removed, the ternary is left alone',
    origin:
      'docs/design/playwright-mutators-opus.md:64 and docs/design/playwright-mutators.md:139, LzJsxConditionalElement',
    jsx: '<Card icon={busy && <Spinner />} badge={busy ? <Dot /> : null} />',
    expect: [['LzJsxConditionalElement', '<Spinner />']],
  },
  {
    id: 'design-12',
    title:
      'a function declared in the file but referenced twice keeps its handler mutants',
    origin: `${release}, LzJsxEventHandler`,
    setup: 'function save() {}\nexport const again = save;',
    jsx: '<form onSubmit={save}></form>',
    expect: [['LzJsxEventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'design-13',
    title:
      'a let handler referenced once keeps its handler mutant, as only a const or a declaration is skipped',
    origin: `${release}, LzJsxEventHandler`,
    setup: 'let save = () => {};',
    jsx: '<form onSubmit={save}></form>',
    expect: [['LzJsxEventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'design-14',
    title:
      'implicit roles of status, separator, paragraph, group, option, progressbar and textbox are skipped',
    origin: rulesOrigin,
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
      ['LzJsxStateAttribute', 'aria-pressed={isSelected ? "false" : "true"}'],
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
        'LzJsxStateAttribute',
        'aria-pressed={isSelected === undefined ? undefined : isSelected ? "false" : "true"}',
      ],
    ],
  },
  {
    id: 'design-15',
    title:
      'a String() or template-literal state gets no negation, which would be a constant false',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div><div aria-expanded={String(open)} /><div aria-checked={`${checked}`} /></div>',
    expect: [],
  },
  {
    id: 'design-16',
    title: 'a boolean or logical state expression is negated',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div aria-expanded={open} aria-selected={tab.active && !tab.locked} />',
    expect: [
      ['LzJsxStateAttribute', 'aria-expanded={!open}'],
      ['LzJsxStateAttribute', 'aria-selected={!(tab.active && !tab.locked)}'],
    ],
  },
  {
    id: 'design-17',
    title: 'a boolean-literal ternary state flips each branch',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div aria-pressed={on ? true : false} />',
    expect: [['LzJsxStateAttribute', 'aria-pressed={on ? false : true}']],
  },
  {
    id: 'design-18',
    title:
      'a .toString() state gets no negation; another method call is negated',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div aria-expanded={open.toString()} aria-checked={state.get()} aria-selected={isOpen()} />',
    expect: [
      ['LzJsxStateAttribute', 'aria-checked={!state.get()}'],
      ['LzJsxStateAttribute', 'aria-selected={!isOpen()}'],
    ],
  },
  {
    id: 'design-19',
    title:
      'a ternary state with no negatable branch gets no mutant; one with a single negatable branch flips only that one',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: "<div><div aria-pressed={c ? undefined : String(x)} /><div aria-expanded={c ? 'true' : undefined} /></div>",
    expect: [
      ['LzJsxStateAttribute', 'aria-expanded={c ? "false" : undefined}'],
    ],
  },
  {
    id: 'design-43',
    title:
      'a string ternary state inside as, satisfies or ! flips each branch and drops the type wrapper',
    origin: `${release}, LzJsxStateAttribute`,
    jsx:
      "<div><div aria-pressed={(s ? 'true' : 'false') as 'true' | 'false'} />" +
      "<div aria-expanded={(s ? 'true' : 'false') satisfies string} />" +
      "<div aria-checked={(s ? 'true' : 'false')!} />" +
      "<div aria-selected={((s ? 'true' : 'false') as string)!} /></div>",
    expect: [
      ['LzJsxStateAttribute', 'aria-pressed={s ? "false" : "true"}'],
      ['LzJsxStateAttribute', 'aria-expanded={s ? "false" : "true"}'],
      ['LzJsxStateAttribute', 'aria-checked={s ? "false" : "true"}'],
      ['LzJsxStateAttribute', 'aria-selected={s ? "false" : "true"}'],
    ],
  },
  {
    id: 'design-44',
    title: 'a boolean state inside as is negated with its type wrapper',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div aria-pressed={flag as boolean} />',
    expect: [['LzJsxStateAttribute', 'aria-pressed={!(flag as boolean)}']],
  },
  {
    id: 'design-45',
    title:
      'an optional .toString() state gets no negation, which would be a constant false',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div><div aria-expanded={s?.toString()} /><div aria-checked={s.toString?.()} /></div>',
    expect: [],
  },
  {
    id: 'design-46',
    title:
      'a literal or undefined state inside as or ! gets no negation, as it gets none unwrapped',
    origin: `${release}, LzJsxStateAttribute`,
    jsx:
      '<div><div aria-expanded={0 as any} /><div aria-checked={null!} />' +
      '<div aria-pressed={undefined as any} /><div aria-selected={0} /></div>',
    expect: [],
  },
  {
    id: 'design-20',
    title: 'a rendered value among the children of a fragment is removed',
    origin: `${release}, LzJsxChildExpression`,
    jsx: '<>{user.name}</>',
    expect: [['LzJsxChildExpression', 'null']],
  },
  {
    id: 'design-21',
    title:
      'a member-named element is never swapped to a span, and its role has no implicit equal',
    origin: `${release}, LzJsxElementRole`,
    jsx: '<div><UI.Button>Go</UI.Button><UI.Dialog role="dialog" /></div>',
    expect: [
      ['LzJsxElementRole', 'role={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-22',
    title:
      "an area with an href is swapped to a span, as Playwright's role table gives it the link role",
    origin: `${release}, LzJsxElementRole`,
    jsx: '<area href="/x" />',
    expect: [
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxElementRole', '<span />'],
    ],
  },
  {
    id: 'design-47',
    title:
      'the span swap drops every attribute of an a, area or button that a span cannot take, and keeps the rest',
    origin: `${release}, LzJsxElementRole`,
    jsx:
      '<div><area href="/x" alt="Map" coords="0,0,1,1" shape="rect" target="_blank" download="m" hrefLang="en" media="print" referrerPolicy="no-referrer" id="m" />' +
      '<a href="/a" target="_blank" rel="noopener" type="text/html" ping="/p" id="a">A</a>' +
      '<button type="submit" name="n" value="v" form="f" formAction="/b" formEncType="text/plain" formMethod="post" formNoValidate formTarget="_self" className="b">B</button></div>',
    expect: [
      ['LzJsxElementRole', '<span id="m" />'],
      ['LzJsxElementRole', '<span rel="noopener" id="a">A</span>'],
      ['LzJsxElementRole', '<span className="b">B</span>'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxUrlAttribute', 'href=""'],
      ['LzJsxLabelAttribute', 'alt=""'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-23',
    title:
      'a guard whose test is an ===, < or >= comparison is left to the built-in ConditionalExpression',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: '<div>{a == b && <p />}{a != b && <p />}{a === b && <p />}{a < b && <p />}{a <= b && <p />}{a >= b && <p />}</div>',
    expect: [],
  },
  {
    id: 'design-24',
    title: 'a filter call among the children is left to ListExpression',
    origin: `${release}, LzJsxChildExpression`,
    jsx: '<ul>{items.filter(visible)}{groups.flatMap(rows)}</ul>',
    expect: [],
  },
  {
    id: 'design-25',
    title:
      'htmlFor on a label that wraps a select, or an input inside a fragment, is skipped',
    origin: `${release}, LzJsxLabelAttribute`,
    jsx: '<div><label htmlFor="a"><select /></label><label htmlFor="b"><><input /></></label><label htmlFor="c"><textarea /></label></div>',
    expect: [],
  },
  {
    id: 'design-29',
    title: 'htmlFor on a label whose children hold no form control is emptied',
    origin: `${release}, LzJsxLabelAttribute`,
    jsx: '<label htmlFor="d"><span>Name</span></label>',
    expect: [
      ['LzJsxLabelAttribute', 'htmlFor=""'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-30',
    title:
      'a negated state holds no built-in mutant of its own expression in the instrumented file',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: '<div aria-expanded={isOpen(a && b)} />',
    expect: [['LzJsxStateAttribute', 'aria-expanded={!isOpen(a && b)}']],
    instrumented: '? !isOpen(a && b) : (stryCov_9fa48(',
  },
  {
    id: 'design-31',
    title:
      'a flipped ternary state holds no built-in mutant of its test in the instrumented file',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: "<div aria-pressed={isOpen(a && b) ? 'true' : 'false'} />",
    expect: [
      [
        'LzJsxStateAttribute',
        'aria-pressed={isOpen(a && b) ? "false" : "true"}',
      ],
    ],
    instrumented: '? isOpen(a && b) ? "false" : "true" : (stryCov_9fa48(',
  },
  {
    id: 'design-32',
    title:
      'a ternary state keeps its unflipped consequent free of built-in mutants in the instrumented file',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: "<div aria-expanded={c ? String(a && b) : 'true'} />",
    expect: [
      ['LzJsxStateAttribute', 'aria-expanded={c ? String(a && b) : "false"}'],
    ],
    instrumented: '? c ? String(a && b) : "false" : (stryCov_9fa48(',
  },
  {
    id: 'design-33',
    title:
      'a ternary state keeps its unflipped alternate free of built-in mutants in the instrumented file',
    origin: `${release}, LzJsxStateAttribute`,
    jsx: "<div aria-expanded={c ? 'true' : String(a && b)} />",
    expect: [
      ['LzJsxStateAttribute', 'aria-expanded={c ? "false" : String(a && b)}'],
    ],
    instrumented: '? c ? "false" : String(a && b) : (stryCov_9fa48(',
  },
  {
    id: 'design-34',
    title:
      'a guard whose test is a ?? expression is removed, as built-in ConditionalExpression leaves ?? alone',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: '<div>{(a ?? b) && <p />}</div>',
    expect: [['LzJsxConditionalElement', '<p />']],
  },
  {
    id: 'design-35',
    title:
      'a label other than htmlFor, and htmlFor on an element other than label, are emptied though a control is inside',
    origin: `${release}, LzJsxLabelAttribute`,
    jsx: '<div><div aria-label="Search"><input /></div><output htmlFor="a"><input /></output><label title="Name"><input /></label></div>',
    expect: [
      ['LzJsxLabelAttribute', 'aria-label=""'],
      ['LzJsxLabelAttribute', 'htmlFor=""'],
      ['LzJsxLabelAttribute', 'title=""'],
    ],
  },
  {
    id: 'design-36',
    title:
      'an attribute with on inside its name, not at its start, is no handler',
    origin: `${release}, LzJsxEventHandler`,
    jsx: '<Card buttonColor={color} />',
    expect: [],
  },
  {
    id: 'design-37',
    title: 'an || fallback is not a guard',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: '<div>{fallback || <p />}</div>',
    expect: [],
  },
  {
    id: 'design-38',
    title: 'a ternary with one JSX branch switches to either branch',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: "<div>{open ? <p /> : 'none'}</div>",
    expect: [
      ['LzJsxConditionalElement', '<p />'],
      ['LzJsxConditionalElement', "'none'"],
    ],
  },
  {
    id: 'design-39',
    title:
      'a removed guard holds no built-in mutant of its element in the instrumented file',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: '<div>{open && <p>{a + b}</p>}</div>',
    expect: [['LzJsxConditionalElement', '<p>{a + b}</p>']],
    instrumented: '? <p>{a + b}</p> : stryMutAct_9fa48(',
  },
  {
    id: 'design-40',
    title:
      'a ternary switched to its consequent holds no built-in mutant of it in the instrumented file',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: '<div>{open ? <i>{c + d}</i> : <b />}</div>',
    expect: [
      ['LzJsxConditionalElement', '<i>{c + d}</i>'],
      ['LzJsxConditionalElement', '<b />'],
    ],
    instrumented: '? <i>{c + d}</i> : (stryCov_9fa48(',
  },
  {
    id: 'design-41',
    title:
      'a ternary switched to its alternate holds no built-in mutant of it in the instrumented file',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: '<div>{open ? <i /> : <b>{e + f}</b>}</div>',
    expect: [
      ['LzJsxConditionalElement', '<i />'],
      ['LzJsxConditionalElement', '<b>{e + f}</b>'],
    ],
    instrumented: '? <b>{e + f}</b> : stryMutAct_9fa48(',
  },
  {
    id: 'design-42',
    title:
      'action, readOnly and an aria-hidden expression are mutated; aria-hidden on a member-named element is not skipped',
    origin: release,
    jsx: '<form action="/save"><input readOnly /><div aria-hidden={hide} /><UI.Icon aria-hidden="true" /></form>',
    expect: [
      ['LzJsxUrlAttribute', 'action=""'],
      ['LzJsxDisabledAttribute', 'readOnly={undefined}'],
      ['LzJsxHiddenAttribute', 'aria-hidden={false}'],
      ['LzJsxHiddenAttribute', 'aria-hidden={undefined}'],
    ],
  },
  {
    id: 'design-26',
    title:
      'a guard or a ternary whose branches are not JSX gives no LzJsxConditionalElement mutant',
    origin: `${release}, LzJsxConditionalElement`,
    jsx: "<div>{open && label}{open ? 'a' : 'b'}</div>",
    expect: [],
  },
  {
    id: 'design-27',
    title:
      'a const handler that is not a function keeps its mutant; a const function expression is skipped',
    origin: `${release}, LzJsxEventHandler`,
    setup: 'const onSave = makeHandler();\nconst onReset = function () {};',
    jsx: '<form onSubmit={onSave} onReset={onReset}></form>',
    expect: [['LzJsxEventHandler', 'onSubmit={undefined}']],
  },
  {
    id: 'design-28',
    title:
      "a role equal to the tag's implicit role in Playwright's getByRole is skipped, for every such tag",
    origin: rulesOrigin,
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
    expect: [['LzJsxElementRole', '<span role="button" />']],
  },
  {
    id: 'design-48',
    title:
      'aria-hidden="false" is not removed, since Playwright reads only "true"; aria-disabled="false" is, since it overrides a disabled ancestor',
    origin:
      'docs/design/playwright-mutators.md:133, LzJsxDisabledAttribute and LzJsxHiddenAttribute',
    jsx: '<form><button aria-disabled="false">One</button><p aria-hidden="false">Two</p><p aria-hidden="true">Three</p></form>',
    expect: [
      ['LzJsxDisabledAttribute', 'aria-disabled={undefined}'],
      ['LzJsxElementRole', '<span aria-disabled="false">One</span>'],
      ['LzJsxTextLiteral', ''],
      ['LzJsxTextLiteral', ''],
      ['LzJsxHiddenAttribute', 'aria-hidden={undefined}'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-49',
    title: 'a handler already bound to undefined gets no removal mutant',
    origin: `${release}, LzJsxEventHandler`,
    jsx: '<button onClick={undefined}>Three</button>',
    expect: [
      ['LzJsxElementRole', '<span onClick={undefined}>Three</span>'],
      ['LzJsxTextLiteral', ''],
    ],
  },
  {
    id: 'design-50',
    title:
      'no forced-off value for a comparison or logical value, and no negation for a comparison: built-in mutants give the same; a ! value is negated, because dropping the ! renders differently when the operand is not a boolean',
    origin: `${rulesOrigin}, LzJsxDisabledAttribute, LzJsxHiddenAttribute and LzJsxStateAttribute`,
    jsx:
      '<form><input readOnly={n > 0} /><p aria-disabled={a && b} aria-hidden={a ?? b} />' +
      '<p aria-selected={tab === current} aria-expanded={!open} aria-pressed={!(a && b)} /></form>',
    expect: [
      ['LzJsxHiddenAttribute', 'aria-hidden={false}'],
      ['LzJsxStateAttribute', 'aria-expanded={!!open}'],
      ['LzJsxStateAttribute', 'aria-pressed={!!(a && b)}'],
    ],
  },
  {
    id: 'design-52',
    title:
      'no negation for a ! value whose operand is boolean by syntax: built-in BooleanLiteral drops the ! and renders the same as !!',
    origin: `${rulesOrigin}, LzJsxStateAttribute`,
    jsx:
      '<form><p aria-pressed={!(a === b)} aria-expanded={!!open} aria-checked={!true} aria-selected={!(a === b && !c)} />' +
      '<p aria-pressed={!(a === b && c < d)} aria-expanded={!(false || a !== b)} /></form>',
    expect: [],
  },
  {
    id: 'design-53',
    title:
      'a ! value whose operand is not boolean by syntax is negated: a call, a member, a -, a &&/|| with an unknown side, or a ?? even between comparisons; so is a - value, which is no ! value',
    origin: `${rulesOrigin}, LzJsxStateAttribute`,
    jsx:
      '<form><p aria-pressed={!isOn()} aria-expanded={!state.open} aria-checked={!(a === b && c)} />' +
      '<p aria-pressed={!(a || b < c)} aria-expanded={-(a === b)} aria-checked={!-a} aria-selected={!(a === b ?? c === d)} /></form>',
    expect: [
      ['LzJsxStateAttribute', 'aria-expanded={!-(a === b)}'],
      ['LzJsxStateAttribute', 'aria-checked={!!-a}'],
      ['LzJsxStateAttribute', 'aria-pressed={!!isOn()}'],
      ['LzJsxStateAttribute', 'aria-expanded={!!state.open}'],
      ['LzJsxStateAttribute', 'aria-checked={!!(a === b && c)}'],
      ['LzJsxStateAttribute', 'aria-pressed={!!(a || b < c)}'],
      ['LzJsxStateAttribute', 'aria-selected={!!(a === b ?? c === d)}'],
    ],
  },
];
