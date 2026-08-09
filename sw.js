/* service worker, offline cache
   caches: shell, thumbs, lightbox images, fonts
   supabase, analytics and ads are never cached
   bump CACHE_VERSION to refill every client

   changelog
   v103 — the legal documents reach the settings menu.
       Seven links below Log Out, in their own group past the end of the
       actions: reference material a member opens once, not somewhere
       they are being sent, so they are quieter than the items above and
       sit under a rule. Same anchors as the footer — a real /legal/<slug>
       href, the modal opening over the drawer on click.
       Changed: index.html, sw.js, css/profile.css.
   v102 — the legal documents get addresses of their own.
       Privacy, Terms, Cookie, Refund and the Creator & Seller terms
       existed only as strings inside js/effects.js, shown in a modal by
       a footer button. Nothing outside the browser could reach them:
       not a crawler, and not the payment provider reviewing this domain,
       which asks to open a refund policy at a URL and reads a delivery
       timeline and a contact route before it will approve a site for
       live payments. Razorpay was refusing payments on this domain, and
       an unreadable policy set is the usual reason a review does not
       pass.
       The text moved to js/legal-content.js, which the modal and a new
       Pages Function both read, so the two cannot drift apart. Seven
       pages now answer at /legal/<slug>, self-contained and dependent on
       no stylesheet or script of ours. Two of them are new: a contact
       page, and a delivery policy saying digital goods arrive on
       payment confirmation and nothing is ever shipped.
       The footer links became anchors carrying those URLs. A click still
       opens the modal — openLegal returns false and cancels the
       navigation — so nothing changes for a member, but the links now
       have somewhere to point when the script has not run.
       Changed: index.html, sw.js, js/effects.js, js/legal-content.js,
       functions/legal/[doc].js, functions/sitemap.xml.js.
   v101 — a section that has not loaded shows nothing, not the section
       before it.
       The account panel keeps all four of its views — Wallet, Payout
       Methods, My Purchases, Currency — in one host, and switching
       between them left the last one's markup up until the next one's
       fetch came back. On a slow connection the wallet's balance was
       readable under the MY PURCHASES heading for as long as the round
       trip took. The host is now emptied the moment the view changes,
       and nothing is drawn in its place: a spinner or a LOADING line is
       still something to read in a section it does not belong to.
       Underneath that, both loaders closed over the host they were
       handed, so a fetch settling after the member had already moved on
       painted itself into whichever view was up by then — the same
       wrong text arriving by the other route. Every paint now carries
       the number it started with and drops what it fetched if the panel
       has moved. The marketplace unlock that rides on the purchases
       response still runs either way, since that is true whichever view
       is showing.
       Likes and Bookmarks share one grid the same way and had the same
       two faults, including two requests that could land out of order
       and put likes under BOOKMARKS. Same treatment, and the error line
       now names the section it is actually in.
       Changed: index.html, sw.js, js/engagement.js, functions/api/store.js.
   v100 — a member picks the currency they transact in, and the site stops
       assuming dollars.
       Twelve currencies — USD, INR, EUR, GBP, JPY, AUD, CAD, SGD, CHF,
       HKD, NZD, SEK — as a fourth item in the account panel. The choice
       sets what a subscription is CHARGED in, what a new listing is
       priced in by default, and which balance the wallet shows first.
       Subscriptions were hardcoded to USD, which is the reason Razorpay
       never offered UPI: it offers UPI, net banking, wallets and EMI on
       an INR order and on nothing else. A member on INR now gets a rupee
       order and the whole domestic checkout with it.
       Plan prices are a TABLE, not a conversion. public.subscription_prices
       holds one row per plan per currency and public.support_limits a
       floor and ceiling for the open-ended amount, both read on the
       service role. Converting $5 at a stored rate would quote Rs 416.67;
       these are local prices — Rs 99 / 449 / 899 against $1 / 5 / 10 —
       and they are the platform's to set, not arithmetic's. Three files
       priced subscriptions and each had its own copy of the list; there
       is now one copy and none of them can disagree with it.
       What the preference deliberately does NOT do is convert anybody
       else's price. A listing belongs to its seller and is bought in the
       seller's currency. Putting a rate in that path is what takes a
       spread out of a seller's money and distorts the tax on it, which is
       the whole thing v98 existed to remove.
       Changed: sw.js, css/hero.css, js/sections.js, functions/api/
       store.js, payouts.js, rzp.js, paypal.js, and a migration adding
       profiles.currency, subscription_prices, support_limits and four
       more fx rates.

   v99 — the account pages leave the public page entirely, and the seller
       terms catch up with what the code actually does.
       index.html carried three Settings items and three page shells for
       the money side of an account. Every figure had already been stripped
       out of them, but the headings themselves still announced — to any
       visitor, any crawler, anyone reading source — that members hold a
       balance and that it gets paid out. None of that is in the page any
       more. /api/store injects the three menu items and builds ONE panel
       with three views, so a signed-out visitor's source has no wallet, no
       payouts, no purchases, and no id or function name hinting at them.
       Three shells that had to be kept in step became one; #walletPage,
       #bankPage and #purchasePage are gone, along with the six open/close
       functions and the two helpers in misc-core.js that drove them.
       The Creator & Seller Terms were wrong after v98 and are rewritten:
       the payment provider's fee is named as a deduction for the first
       time, the flat 7-day clearing period is replaced by the providers'
       real settlement windows, TDS is stated as withheld at the sale
       rather than at payout, GST TCS is described, and the currency
       promise — earned, held and paid in one currency, never converted —
       is written down. They stay publicly readable: a seller has to be
       able to read the terms before listing.
       Dead code deleted rather than left to be puzzled over later: usd(),
       an unused say() helper, and the .dzPayNote, .dzPayAmt, .dzPuHead,
       .dzRowFields and .dzCoTone--green rules, none of which had matched
       anything since the checkout page landed.
       Follow-up in the same release, no shell asset touched so nothing to
       bump: the checkout chooser now asks what the ORDER'S CURRENCY can
       actually be paid with. Razorpay offers UPI, net banking, wallets and
       EMI on an INR order and on nothing else — a USD order gets
       international cards — so listing UPI beside a dollar price was a
       promise the checkout window then broke, after the buyer had already
       chosen. PayPal is dropped from the chooser entirely for a currency
       it cannot settle, INR above all, rather than being offered and then
       refusing. And the hand-written 'method' list is no longer sent to
       Razorpay at all: it could only ever subtract from what the account
       has enabled, including methods it was never written to know about.
       The ?v= on every shell file this release touched is bumped in BOTH
       index.html and the precache list here. They key on the full url
       including the search, so a list that moves in one place and not the
       other precaches urls nobody asks for — the exact fault v69 was
       written to fix, and easy to walk straight back into.
       Changed: sw.js, index.html, css/hero.css, js/misc-core.js,
       js/app-core.js, js/sections.js, js/auth.js, js/effects.js,
       functions/api/store.js.

   v98 — the wallet stops promising money that is not there, and the seller's
       money stops being converted.
       Two faults, both about the same number. A sale credited the seller
       with gross-minus-commission after a flat seven days, and three
       things were missing from that: the gateway's own fee, which
       Razorpay and PayPal take before a rupee reaches us; TDS under
       section 194-O, which the statute withholds at credit or payment
       whichever is EARLIER, so taking it at payout time was late and was
       taken a second time on a balance that already had it deducted; and
       GST TCS under section 52, which was not collected at all. The seven
       days were invented — the providers say when they settle, and it is
       T+2 working days for Razorpay domestic, T+7 international, up to
       five business days for PayPal.
       And the wallet totalled every currency into USD while the payout
       form asked for dollars, so a euro sale crossed a spread to be shown
       and again to be paid, with the tax basis computed off the far side
       of both. fx_rates.usd_rate is dropped: no query can route through
       the dollar again.
       Now: a sale lands in PENDING holding the whole gross, withdrawable
       by nobody, with every deduction listed beside it and the date it
       clears. When the provider's window elapses it becomes WALLET,
       holding only what survived. The two are separate sections and are
       never added together. Both are per currency, and a currency is
       never converted — earned in euros, held in euros, paid in euros.
       The one conversion left in the system is our own commission into
       INR, once, at a rate frozen on the row, because that and the
       subscriptions are the only money that reaches our bank.
       Every deduction is computed in ONE place now — a Postgres trigger —
       instead of in the four checkout paths that each had their own copy
       of it. Those paths send facts and no arithmetic: what the buyer
       paid and what the gateway took, read from the provider rather than
       estimated from a rate card.
       Also fixed while in here: recordEarning appended to the append-only
       ledger on every replay, so a webhook arriving after the browser had
       already settled the same sale credited it twice, the two records
       then disagreed, and dz_reconcile froze an honest seller's
       withdrawals with no way back. The append now happens only on a real
       insert.
       Changed: sw.js, css/hero.css, functions/api/store.js, payouts.js,
       rzp.js, paypal.js, rzp-webhook.js, paypal-webhook.js, and
       supabase/migrations/20260802_money_flow.sql (applied).

   v97 — checkout is a page, the two gateways are told apart, and Razorpay
       finally has a webhook.
       Buying used to open a small sheet that asked "Razorpay or PayPal?"
       and nothing else. A buyer tapping Buy saw no title, no total and no
       statement of what they were about to receive, and the two options
       sat in one stack reading as interchangeable — which they are not.
       Buy now opens a full page: DigiArtz at the top, then what is being
       bought with its price, what the money gets and the total, then the
       payment method, then the gateway itself. Three numbered steps, and
       the gateway one does not exist until a method is chosen — nothing
       is ordered and no ledger row is written before that point, so
       leaving from step one still costs nothing.
       The two providers are now drawn as alternatives with a real "or"
       between them, each in its own logo and its own colours — Razorpay's
       blue, PayPal's navy and gold — written as fixed hex rather than
       theme variables, because a Razorpay card that turns purple in one
       theme stops looking like Razorpay. Both marks are inline SVG: a
       payment choice must not wait on someone else's CDN. They differ in
       what they take, and the page says so: Razorpay handles cards —
       credit and debit — plus UPI, net banking, wallets and EMI; PayPal
       is the PayPal account alone. Every card and local funding source is
       switched off in the PayPal SDK url, so its guest "Debit or Credit
       Card" button is not offered here at all. A buyer who backs out of
       either window lands back on step two with the reason on it, order
       intact.
       The methods carry their own marks as well as their names: Visa and
       Mastercard for the card line, Google Pay and PhonePe for UPI, each
       in the brand's colour on a white chip, which is the background all
       of them are drawn for and the only one that reads the same in every
       site theme. UPI and RuPay have no artwork we can carry offline and
       an approximation would be worse than none, so the apps that ride
       UPI stand in for it and the exact wording stays in the chips
       underneath, where nothing is left to a logo to imply.
       The summary carries the plan's own colour too — Lite blue, Premium
       purple, Max gold, the same hexes as the plan grid — so what is
       being paid for is recognisably the card that was tapped. The bar
       above it wears the site wordmark the way the hero badge does.
       And the webhook. /api/rzp-webhook is the Razorpay half of what
       PayPal has had all along: the settlement of record, for the buyer
       whose tab closed between paying and the browser confirming it, and
       the only way a refund or a chargeback days later is ever heard
       about. Signed with RAZORPAY_WEBHOOK_SECRET over the RAW body,
       fails closed with no secret bound, idempotent against the browser
       having already verified the same payment, and it refuses to fulfil
       on an amount that does not match the order. A partial refund does
       not revoke a purchase; a lost dispute does, and an opened one
       parks the seller's share rather than paying it out mid-argument.
       Changed: sw.js, css/hero.css, js/sections.js, functions/api/
       store.js, functions/api/rzp-webhook.js (new), config.example.js.

   v96 — the marketplace sells files instead of pointing at them.
       A listing used to be one product file uploaded to the public
       bucket, with a Download button drawn for every visitor and refused
       at the database. Both halves of that were wrong. The button
       advertised a file to people who had not bought it and read as
       broken when it said no, and the object behind it sat in koe-media,
       where the url is the whole of the security — a link, once loose,
       was the goods.
       A listing now carries as many files as the buyer receives. They
       upload to koe-originals through a new visibility:"private" flag on
       the signer, which returns no public url because there is none, and
       they come back only through /api/market-download: it asks Postgres
       whether this caller has paid, signs the object for two minutes with
       the service role, and streams the bytes. The browser never holds a
       url of any kind, so a buyer cannot pass one on.
       Ownership has one definition, dz_market_owns — seller, free
       listing, or a payment for this item by this user standing at
       'paid' — and the card, the detail view, My Purchases and the
       download all ask it. It is derived from payments rather than
       kept in a purchases table, so a refund or a chargeback withdraws
       the download in the same instant it reverses the earning, with no
       second copy of the truth to fall out of step.
       There is no download control anywhere until that question comes
       back yes. The listing shows the price and a lock note; the
       signed-in module swaps in the download once it knows. Subscription
       tiers are not consulted at any point on this path — no tier
       unlocks a marketplace file and none is spent reading one, so a
       purchase costs nothing to re-download for as long as the account
       exists.
       Settings gains My Purchases: everything bought, newest first, with
       every file at full quality, surviving the seller delisting the item
       (the title falls back to the label written on the payment at
       checkout). A finished checkout lands there rather than back on the
       listing, because that is where the buyer's next question is
       answered.
       The scheduler learned about the second write too: a listing queued
       for Friday carries its files in scheduled_sections.sell_files and
       gets them attached in the same pass that creates it, or fails and
       takes the half-made listing back down.
       Changed: index.html, sw.js, css/hero.css, js/sections.js,
       js/app-core.js, js/misc-core.js, js/pfedit.js, functions/api/
       store.js, functions/api/market-download.js (new), functions/api/
       rzp.js, functions/api/paypal.js, supabase/functions/smart-function,
       and three migrations under supabase/migrations.

   v95 — the wallet says what the rules are, on the page where they apply.
       The withdrawal minimum, the split we take, what happens to a
       balance inflated by one of our own bugs and where to write with a
       question were nowhere a member could read them; they now sit at
       the foot of the wallet, under the balance and the payout button
       they describe. Six numbered rules, rendered by the same signed-in
       module as the rest of that page, so a signed-out visitor still
       finds an empty container. The support address is a real mailto —
       one tap opens the mail client with the subject filled in, rather
       than asking anyone to copy an address out of a paragraph.
       The list numbers itself with a CSS counter on a plain <ol>, so the
       marker keeps its place against the border no matter how far a rule
       wraps, and the rows are the same card the wallet uses everywhere
       else. Long text breaks rather than pushing the page sideways, and
       the narrow-screen rule tightens the padding so a rule still reads
       as one column on a phone.
       Changed: index.html, sw.js, css/hero.css, functions/api/store.js.

   v94 — the admin entry is built for the account that has it, not hidden
       from everyone else. #smAdmBtn was written into the settings list on
       every page load and held back by two lines of stylesheet. That is
       not hidden. It was in the source of every visit, it answered a
       click, and the click answered back — "sign in with a dev account to
       access admin" to a signed-out visitor, "this account does not have
       dev access" to everyone else — which told anyone who tripped it
       that there was something there to get into. Both messages are gone;
       an account that is not entitled to the panel now gets silence.
       syncAdmBtn builds the entry when the role check comes back dev and
       removes it when it does not, so an ordinary page carries no entry
       at all. #admPage ships as an empty div and admBuild() writes the
       inside of it on first open, so the panel's own words — the title,
       the broadcast box, the reports tab — never reach a page that will
       not use them. The element itself stays in the markup because the
       nav watcher and the floating-widget watcher both pick their panels
       up at load.
       This is presentation, and it always was: the panel's power comes
       from the role on the row in profiles, and every table it touches is
       still policed by RLS. Nothing here is a permission change. It stops
       advertising a door that was already locked.
       Changed: index.html, css/profile.css, js/gallery.js, js/pfedit.js.

   v93 — the bottom nav floated over Settings, and Settings forgot where
       you had been. Two faults of the same panel, both new with the
       Settings menu itself.
       The nav sits at z-index 1000 and every sliding page sits below it,
       so a page is only clear of the nav because it switched the nav off
       on the way in and back on the way out. Nine panels carried their own
       copy of that pair, two more carried only the half that puts it back,
       and #setPage — along with the wallet, payout methods, subscription,
       edit my work and admin pages it opens — carried neither. Every copy
       is gone; one watcher in app-core.js reads which panels are open and
       sets the nav from that. A panel joins by being named in NAV_OVER
       rather than by remembering to write both halves, and the halves
       can no longer drift apart — album detail closing back onto the
       album manager used to restore the nav over a page still open.
       The nav's own five destinations are deliberately absent: it stays
       up over gallery, community, upload, login and profile, which is
       where it marks the section you are in.
       Second, Settings is a menu, and the page an item opens is a step
       further in. Each item closed Settings outright, so the back arrow
       on the wallet returned to the profile and the menu had to be
       reopened for the next item. Items now go through setGo(), which
       closes the menu, opens the page and brings the menu back when that
       page closes. Back arrow, Escape and Log Out still leave Settings
       for good, and a page that never opened — a signed-out tap answers
       with a toast — puts the menu straight back instead. Nothing comes
       back if the profile underneath was left by some other route.
       Escape closes the wallet and payout methods too, which it never
       did: they were the only sliding pages missing from that handler,
       and the way out of Settings has to be the same from all of them.
       Changed: index.html, js/app-core.js, js/auth.js, and the nav pair
       dropped from js/albums.js, js/dm.js, js/engagement.js,
       js/misc-core.js, js/mywork.js, js/pfedit.js, js/profile.js,
       js/ranking.js, js/theme.js.

   v90 — a second, independent record of every movement, and nothing
       leaves without the two agreeing. The wallet's total is derived
       from the operational tables; a bug there is a bug in the only
       number that exists, and sixteen dollars reading as a hundred and
       nine is sixteen dollars paid out as a hundred and nine.
       Two copies of the same table would not have fixed that — written
       by the same code from the same figures, the bug writes the wrong
       number to both, they agree, and the check passes. So the second
       record is independent in two ways that matter. Its SOURCE is what
       the provider itself reported, its own transaction id and its own
       amount, taken live at settlement rather than from our arithmetic.
       Its STORAGE is append-only: update and delete are refused by a
       trigger and withheld at the grant level from every role, the
       service role the backends run as included. History cannot be
       rewritten by anyone.
       Each entry also hashes the one before it, so a row edited in place
       breaks the chain from that point and the break is findable. A
       plain duplicate has no such property; it can be quietly corrected
       to match.
       The two are compared per currency in minor units, never in USD, so
       an exchange-rate change cannot manufacture a disagreement. A
       withdrawal reconciles first and is refused if they differ, the
       member is shown a red mark and a way to reach support, and the
       account stays frozen until a human clears the flag. This check
       fails CLOSED, the opposite of the rate limiter: a broken limiter
       must not stop a customer, a broken balance check must not let
       money out.
       Verified end to end against a real sale. Healthy: both sides
       1700. Corrupted so the wallet claimed 10900 while the record held
       1700: caught, discrepancy 9200, refused. Three other constraints
       turned out to catch cruder corruptions before reconciliation was
       even reached. The ledger refused every attempt to edit or delete
       it, chain intact throughout.
       The debit booked at payout is the total actually retired, not the
       amount requested — retirement walks whole earnings and the last
       one overshoots, so booking the request would leave a permanent few
       cents of disagreement and flag an honest seller forever.
       Changed: index.html, sw.js, css/hero.css, and the money backends
       under functions/.

   v89 — withholding, a support address, and a five dollar floor. Every
       policy carried a [your contact email] placeholder where a contact
       address belongs; both payment providers check for a reachable one
       during merchant review, so all six now name the support account.
       Indian sellers: section 194-O makes the PLATFORM, not the seller,
       responsible for deducting tax at source on the gross value of a
       marketplace sale. It is computed against the sales a payout
       settles — walked from the earnings rows rather than derived from
       the fee rate, since the rate is recorded per sale and older rows
       may carry a different one — and taken off what leaves. 0.1% with a
       PAN on file, nil for an individual under five lakh of sales in the
       financial year, 5% with no PAN under 206AA, nothing at all for a
       seller resident elsewhere. No declaration on file is treated as
       Indian residence without a PAN: under-withholding is the platform's
       liability, over-withholding is the seller's to reclaim. Profile
       settings takes the country and PAN, the seller terms say all of it
       plainly, and the payout sheet says what was withheld.
       The withdrawal minimum is five dollars.
       Changed: index.html, sw.js, css/hero.css, js/effects.js, and the
       payout backend under functions/.

   v88 — a wallet, and the terms that had to come with it. Profile settings
       gains two sections: what a member has earned and where they want it
       sent. The header totals in USD from a stored rate table rather than
       a live feed, because a balance that reads differently on every
       refresh is worse than one honestly a day old. Totals are computed
       in one database function, so the browser never adds money up — it
       formats what it was handed. Below them sits one history: what the
       member bought, what somebody bought from them, and what they
       withdrew, as a union view that inherits the row policies rather
       than working around them.
       Payout methods are one row per instrument, so a PayPal address and
       a UPI id can sit side by side. NOTHING RAW IS STORED. No card
       number, no full account number, no CVV — a card number would put
       this project in PCI scope and a leak of that table would be
       unrecoverable. A bank row keeps the last four digits so its owner
       can recognise it, the IFSC, and a provider token; the account
       number is read, validated, and thrown away. A check constraint
       enforces that shape rather than trusting whoever calls. Cards stay
       where they belong, inside the provider's own checkout.
       Every prompt here is themed and in the sheet. Nothing asks for
       money through a browser dialog any more.
       The legal half is not decoration. The platform now takes a
       commission and holds other people's money, and there were no terms
       saying so — no commission rate, no clearing period, no statement
       that a balance is a record rather than funds held in the seller's
       name, nothing about who owes what when a sale is reversed after a
       payout. Creator & Seller Terms says all of it, and the refund
       policy now covers marketplace items and reversals.
       Hardening: the money endpoints take a per-member rate limit,
       counted and tested in one atomic statement so two simultaneous
       requests cannot both read as one under the cap. Cloudflare already
       absorbs the floods; this is for the cheap targeted abuse it has no
       reason to block — walking item ids through checkout, or hammering
       a payout race. It fails open, because a broken limiter must not
       stop a paying customer.
       Changed: index.html, sw.js, css/hero.css, js/effects.js, and the
       backends under functions/.

   v87 — a second checkout, and a gate in front of both. The site had one
       provider, whose account is not activated yet, so a second one now
       sits beside it: a new backend under functions/, answering the same
       three questions the first one does — order a plan, order a listing,
       settle one — and writing the same ledger table. That table grew a
       provider column and a second pair of id columns, and the first
       provider's order id stopped being NOT NULL, since a row from the
       other one has none. A check constraint keeps a row from claiming
       one provider while holding the other's ids, and the new id column
       is unique, which is the same replay guard the first one has: a
       settlement that arrives twice only finds an open row once, so a
       subscription is never extended twice for one transaction.
       Which one a buyer gets is not decided in this repo. Both backends
       are asked, at request time, whether their credentials are bound to
       the Pages project; one live and the buyer goes straight into it,
       two and a sheet asks first. That is what lets the new one carry the
       site alone today and the older one appear later with no code
       change.
       The larger half of this release is that none of the above is
       readable by anyone who is not signed in. Everything to do with
       money — the module that runs it, the names involved, the plan grid,
       the amounts, the buy controls, the endpoint paths — moved out of
       the static bundle into a Pages Function that answers only a request
       carrying a valid session, and is served no-store. index.html holds
       an empty container where the plan grid was; the renderers emit an
       empty slot where an amount and a button belong; this file and the
       assistant corpus no longer name a provider or a figure anywhere,
       changelog included, which is why the entries below read the way
       they do. The API was closed behind the same line: the listing
       table's amount column is revoked from anon at the column level, so
       a signed-out visitor cannot read one off the endpoint either —
       which is why the select list only asks for it when there is a
       session, a column-level denial failing the whole query rather than
       returning null. Signing in or out drops that section's cache, since
       rows fetched in the other state are the wrong shape.
       That gate leans on this file behaving. /api/* was never cached
       before by accident — every endpoint took POST, and the fetch
       handler ignores non-GET — but the new one answers GET with
       per-caller content, and caching it would serve a signed-in answer
       to whoever asked next. /api/* is now an explicit bypass, and
       _headers carries no-store for the same paths as a second lock.
       Worth stating plainly rather than implying: once a signed-in buyer
       opens the sheet, that module is running in their browser and the
       provider's public identifier is in the script url it loads. Those
       identifiers are designed for exactly that and are worthless without
       the secrets, which never leave the Worker. The gate is against
       everyone up to that point, which is every visitor without an
       account.
       Changed: index.html, sw.js, _headers, css/hero.css, js/sections.js,
       js/profile.js, aiAssistantData.js, and one existing backend under
       functions/; two more under functions/ are new.

   v86 — the favicon Google could never use. Two things kept it out of the
       search result. Every icon the page declared topped out at 48px —
       the .ico held 16/32/48 and the six PNGs were 16/32/48 — where
       Google wants a square larger than 48; the 192 and 512 icons that
       would have qualified were only ever named in site.webmanifest,
       which Google does not read when choosing a favicon. And all six
       PNGs were declared behind media="(prefers-color-scheme: …)", which
       Google ignores — it takes one icon per hostname and does not
       evaluate media — so the six collapsed into a set it had to guess
       at, leaving the 48px .ico as the only unambiguous candidate.
       favicon.ico is rebuilt from icon-512.png at 16/32/48/64/128, so the
       .ico clears the floor on its own, and icon-192.png is now declared
       as a plain rel="icon". Nothing in the set is theme-conditional or
       under 48px any more, so whichever Google picks is a valid answer.
       The trade is the dark-mode tab icon v27 added: with the media
       queries gone, browsers take the largest match and dark-mode tabs
       show the white-background bird instead of the white-on-transparent
       one. The -dark and 16/32/48 PNGs stay on disk, unreferenced.
       Precache drops /favicon-32x32.png, which the page no longer
       requests, and the six now-unreferenced 16/32/48 light and -dark
       PNGs are deleted.
       Two Pages Functions were also sitting at the repo root, where the
       root is the deploy output and nothing outside functions/ is
       compiled — _headers and _redirects are read by Pages, but a stray
       .js is just a static asset. _middleware.js was a byte-identical
       copy of functions/_middleware.js, kept in sync by hand, and is
       gone. The other was a backend that belongs under functions/: it
       had never been routed, so the endpoint 404'd and everything that
       depended on it failed, while the file itself was downloadable at
       the repo root. It moves under functions/api/ unchanged — it holds
       no hardcoded secrets, reading everything it needs from env, all of
       which must be bound to the Pages project for the endpoint to
       answer.
       Changed: index.html, favicon.ico, sw.js; rzp.js moved.

   v85 — the log lines ran off the side of a phone. A grid column written
       as 1fr is minmax(auto,1fr), and that auto floor is the widest the
       row's own content wants to be — so one long title pushed the track
       past the viewport and the line was cut at the screen edge, border
       and all. Measured at 360px: a row 426px wide in a 360px window. The
       square boards never showed it because a picture has no text to
       measure. The three log grids are minmax(0,1fr) now, and the row
       carries min-width:0 behind it.
       With the row no longer able to grow, the words inside it wrap
       instead of truncating: the sentence and the title each take up to
       two lines, three for the title under 380px, and a word longer than
       the row breaks rather than pushing it. The chips wrap too. Same
       treatment for the artist card's display name, which lost its second
       half at 320px, and the banner gives its text 74% of the width under
       420px, where 64% left the bio a line short.
       The log chips are labels, not controls — a tap on one names the
       kind and the category and no longer opens the upload.
       Audited at 320, 360, 390, 430, 540, 700, 900, 1280, 1600 and 1920
       across every board: nothing overflows its grid, its card or the
       page.
       Changed: index.html, css/hero.css, js/feed.js.

   v84 — the hero page's search bar is now a rail of boards. The bar was one
       input over a grid that was always the same trending order; in its
       place sit six tabs — Trending, New arrival, Weekly hits, Monthly
       hits, Artists, Logs — in one scrolling line, no scrollbar and no
       progress track under it. The line is centred on every device, and
       safely so: once the tabs are wider than the screen it lines up from
       the left instead, since a centred overflow puts the first tab off
       the edge with no way to scroll back to it.
       Switching costs no request: every board
       reorders the artworks already loaded, and each is capped at 200.
       Trending is unchanged, and New arrival is the newest-first order the
       gallery already had. The two new boards score on the same points a
       view is 1, a bookmark 8, a download 6 — and differ only in how those
       points fade. Weekly counts age in whole weeks, so everything
       uploaded inside the current week divides by the same number and the
       board is a straight points race for seven days, dropping a step each
       week after. Monthly counts age in whole months and halves: 30 days
       on, an artwork's points are worth half of what they were here.
       Artists reads the trending order back as the people behind it — the
       first card is whoever made the first thumbnail, one card per artist
       — as a square holding their picture, name, @username and a view
       profile that opens their page. Behind it sits their own banner at
       60%: the banner is drawn desktop-wide, so a square card shows the
       middle of it and nothing else, asked for at the 600 size since only
       that middle third survives the crop. The lower half fades into the
       card's surface, because a banner is somebody's artwork and can be
       bright exactly where the name goes.
       Over Trending, Weekly hits and Monthly hits sits the artist holding
       first place on the board being read, as a banner two cells wide and
       one tall — the narrowest grid is two across, so it is a full row on
       a phone and half a row on a desktop, and never breaks the grid. It
       carries the eyebrow, their @name, their bio and a view profile, with
       the winning artwork itself as the picture. The bio is cut to two
       sentences and an ellipsis — a profile bio runs as long as its owner
       likes, and the cut lands where the writing already breaks rather
       than mid-word. Its picture carries its own sizes: the banner is two
       cells wide and the picture covers 60% of that, so the grid's own
       sizes would have fetched the 300 for a box that wants the 600. That artwork is promoted
       out of the grid rather than repeated above it: the piece that won
       the board is the picture on the banner, and showing it twice, one
       directly above the other, reads as a bug. First place plus the 199
       behind it is still 200. The picture opens the artwork, the button
       opens the artist, and neither is nested inside the other.
       Logs is who uploaded what, newest first, across all four things a
       member can publish — artwork, marketplace, blog, resource. A line
       carries the uploader's face and @name, what they uploaded and the
       date, then its title and its category, as a long rectangle: one
       column on a phone, two on a desktop, three past 1600px. The
       artworks are already in hand from the home load, so this costs
       three queries of five columns each, once per session. Opening a
       line opens the thing itself — an artwork in the lightbox, the other
       three in their own section's view, which is always reachable: the
       newest 200 of everything is a subset of the newest 200 of each
       kind, so anything the log shows, its section has too.
       Every board fills the same way the grid already did — a first
       screenful, then more as you reach them, never 200 at once — and the
       artist cards and log lines fetch their faces per batch, in one
       query, skipping anyone already held.
       The house rules hold across all of it: nothing new is selectable,
       copyable or draggable — css/select.css is still the only list and
       none of this asks to be on it — every picture is a generated webp
       size rather than a full-size file, every one of them is lazy, and
       switching boards rises in over a quarter of a second instead of
       cutting, for anyone who has not asked for less motion.
       None of this touches the gallery, which keeps its own filters and
       its own search; ⌘K now belongs to it alone. Removed with the bar:
       the feed's search filter and the profile lookup that backed it. Also
       gone is #homeGrid, a display:none div that every render rebuilt out
       of every artwork on the site and nothing ever read.
       Changed: index.html, css/hero.css, css/ranking.css, js/app-core.js,
       js/search.js, js/tagrail.js, js/sections.js, and js/feed.js, which
       is new.

   v83 — the profile line rides around the avatar instead of across it.
       Four of the five nav items hold a line icon in the middle of a 58px
       circle, so a line cut to the dot's radius has clear space to run
       through. The fifth is an avatar filling 42px of that same circle,
       with a 2px glow ring outside it, and the line was landing straight
       on its edge — two circles of nearly the same radius, one drawn over
       the other.
       The radius is now measured off whichever of .nAvatarBtn or
       .nLoginBtn is actually showing, plus its glow and half the line's
       own width, and clamped to stay inside the item: 25 against a 42px
       avatar, 23 against the 38px one under 640px, where the other four
       stay at 22 and 19. The line comes out tangent to the avatar's outer
       glow — tracing its edge, touching neither it nor the item's rim.
       This does put the profile mark a few px higher up its circle than
       the other four sit on theirs, which is invisible in practice: only
       the active item carries a mark, so no two are ever on screen at
       once.
       Changed: index.html, js/navprogress.js.

   v82 — the gallery cut to the top instead of riding there. Tapping the
       icon of the section you are in glides home and community up over
       about half a second; the gallery arrived instantly, and upload,
       profile and community-after-a-rebuild had the same flaw waiting.
       The cause is that the handler behind the tap runs first, and a
       section that rebuilds itself on the way in — openFG replaces the
       whole grid — is already sitting at the top by the time the glide
       gets its turn on the next frame. It read scrollTop 0, had nothing
       to travel, and returned. The offset is now taken in the nav's own
       capture-phase listener, before that handler runs and while the
       section still stands where the tap found it, and the glide puts it
       back before the frame paints and rides down from there. Nothing
       flashes, because the restore and the first step happen inside the
       same frame the rebuild did.
       Traced frame by frame at 1200px: hero, gallery and community now
       run the identical curve — 1200, 798, 437, 205, 75, 16, 1, 0 — and
       a touch part way through still stops all of them dead, verified
       in-page so the reading and the touch cannot drift apart.
       Changed: index.html, js/navprogress.js.

   v81 — the nav mark is tuned per theme, and the glide respects a reader
       who asked for less motion. One alpha for all three themes does not
       land the same way in all three: the mark is near-white over
       near-black on dark and graydark and near-black over white on light,
       and measured against the pill it sits on, .5 gave 3.89 on dark,
       3.62 on graydark and 3.10 on light — the light theme visibly the
       faintest of the three. --bnMark now carries .5, .53 and .57, which
       reads as 3.89 / 3.85 / 3.75: the same weight in each theme rather
       than the same number in the stylesheet. Contrast was sampled off
       rendered pixels, not computed from the tokens, since the pill is
       itself translucent over a translucent nav.
       Tapping the section you are in still goes to the top under
       prefers-reduced-motion, but arrives there rather than travelling —
       the glide was the one thing this file animates that a reader cannot
       opt out of by scrolling, since it is the response to their own tap.
       Changed: index.html, css/base.css, js/navprogress.js.

   v80 — every section keeps its place, and the nav is what gives it up.
       Leaving a section and coming back put you at the top of it: home
       because bnGoHome scrolled there on every tap, gallery because
       openFG threw the rendered grid away and rebuilt it from the first
       batch. Reading half of something, glancing at a profile and losing
       the half you had read is the whole cost of that.
       js/navprogress.js now records the offset of whichever section is
       active — on every scroll and every 380ms poll, and only while the
       box reports room to scroll, so the flat reading a locked page gives
       while a panel is over it can never overwrite a real one. When a
       section becomes active again the offset goes back, retried for
       1500ms at 70ms intervals because sections rebuild their content on
       the way in and there is nothing to scroll until they do, and
       abandoned the moment it lands or you touch the page yourself.
       Tapping the section you are already in is now what goes to the top,
       as a glide this file drives frame by frame — 260ms plus a fifth of
       the distance, eased out, capped at 760ms — so that a touch, wheel
       or key can stop it half way and leave you where it stopped.
       Programmatic scrolls go through scrollTo with behavior 'instant',
       since html{scroll-behavior:smooth} would otherwise animate every
       step of a glide that is already an animation.
       bnGoHome keeps its own scroll to the top, behind a check for
       window.bnScrollMemory, so a client that never gets the new script
       still has a way up. openFG stops resetting fgVisible and instead
       caps it at the initial batch plus eight steps: the grid returns at
       about the size it was left at, which is what makes a gallery offset
       mean anything, while past that depth the thumbs have aged out of a
       60-entry cache and rebuilding them all would cost a fetch each.
       The line follows from this for free. A section reactivating already
       resets it to zero, so coming back sweeps up to the restored spot
       from nothing rather than appearing part-drawn, and a glide to the
       top drains it on the way up.
       Changed: index.html, js/navprogress.js, js/pfedit.js, js/app-core.js.

   v79 — the dot under the active nav item stretches into a scroll line.
       The dot said which section you were in and nothing else; the line
       says that and how far down it you are. Nothing else about the nav
       moves: same place, same 4px width, no track ring behind it, icons
       untouched. Dot and line are one stroke — an arc on a circle through
       the dot's own centre, dashed to the reading, with round caps, so at
       zero the cap alone is the dot and there is no second element that
       could sit at a different brightness. It grows clockwise from there
       around the icon, reading left to right across the top, and closes
       back onto its own start. The stroke is half the source colour and
       carries no glow, since a line that long throws far more light than
       a 4px dot did and would otherwise take the nav over. The css dot
       stays in the sheet as the fallback and is hidden only under
       #bnNav.bnMarks, which the script adds once the line exists, so a
       client that never gets the script keeps the dot it had.
       The reading is scrollTop / (scrollHeight - clientHeight) on the box
       that section actually scrolls — the document for home, #fg,
       #pfUpMod and #profilePage on the panel itself, .cmScroll inside
       #communityPage — resolved by hunting for the scrollable box and
       then confirmed by whatever element the section's scroll events
       really come from. The arc's radius comes off the item's own pixel
       box each time it is sized, since the nav is 58px wide and 52px
       under 640px while the dot stays 5px off the bottom in both.
       Nothing here snaps. The line eases toward the reading each frame at
       8.2/s going forward and 4.2/s coming back, so scrolling up drains
       it more gently than scrolling down fills it. That asymmetry is the
       point on the two lazy sections: gallery and hero grow while you
       read them, every new batch of thumbnails makes the denominator
       bigger and the reading smaller, and the line gives progress back
       over the same soft curve instead of stuttering backwards. A 380ms
       poll catches that growth, since content landing fires no scroll
       event. The rAF loop only runs while the line is still moving.
       Changed: index.html, css/base.css, js/navprogress.js (new).

   v78 — community chats open as a panel that slides in from the right,
       the way profile, gallery and community itself already arrive
       (supersedes v77, which covered the same work mid-flight).
       Tapping a community, group or DM used to swap two divs in place —
       the grid to display:none, the chat into its slot, a 26px nudge as
       the only transition — so the one destination people open dozens of
       times a day was the one that did not move like the rest.
       #cmChatPanel is built like #zeoPage, because that is the panel on
       this site that already gets it right: a body-level fixed sheet
       carrying its own header, both chat views and the composer, so
       everything the chat needs travels with the slide. Same curve, .4s
       cubic-bezier(.22,1,.36,1) with visibility 0s linear .4s.
       Body-level is the part that matters. Inside #communityPage the
       panel would sit under z-index 500 and a transform, sealed into that
       stacking context and unable to paint over #bnNav at 1000 — which
       is why a first pass had to switch the nav off before the slide and
       back on after, a cut at each end that reads as the nav taking a
       moment to go. Zeo never touches the nav; it covers it. At z-index
       1500 — over the nav, under the emoji picker at 2100, the showcase
       picker at 2200 and the modals at 4300 — so does this, so the nav is
       covered going in and uncovered coming out, progressively, with
       nothing left to time against it.
       The community page stays open underneath, because you are still in
       that section, and the grid keeps its scroll position for the same
       reason. Being outside #communityPage costs the panel that id's
       descendant selectors, so every rule scoped to it gains a
       #cmChatPanel twin, the --cm* token block included; grid-only
       selectors come along for consistency and never match inside the
       panel. The header split for the same reason one element cannot be
       in two places: the grid keeps the COMMUNITY title, the chat banner
       moved into the panel, and cmHdrHomeMode no longer repaints it — it
       drops the tap handler and leaves the banner intact on the way out.
       Leaving the section is not a slide: cmChatPanelReset commits the
       closed state with transitions suppressed, so the chat never
       animates out across a page that is animating in.
       The composer had two separate delays, neither of them a
       transition. It sat 84px off the bottom holding room for a nav bar
       that is hidden inside a channel, and focusing the input dropped
       that padding while translating the bar, changing its height and
       position at once — the bounce on tap, and the gap left behind when
       a stale transform outlived the keyboard. As a child of the panel it
       sits at the foot on its own, and the keyboard is handled by padding
       the panel: the column shortens, the bar keeps its size, and the
       panel goes on painting behind the keyboard.
       The second delay was a real second. openThread hid the DM bar and
       left it hidden until loadFriendships() returned, so the friend gate
       cost a network round-trip before the composer could exist. It now
       paints from the cached frMap on the way in and the refresh corrects
       it. Someone never loaded still gets the placeholder, since guessing
       there would flash the wrong bar, and sends stay server-gated by RLS
       either way, so an optimistic composer cannot post to a stranger.
       Six shell files changed, so their ?v= moved with them, here and in
       index.html together. index.html carries no ?v= of its own and rides
       CACHE_VERSION — which matters more than usual here, since the new
       markup against v76's stylesheets is a broken community page rather
       than a cosmetic difference.
       Changed: index.html, css/community.css, css/viewer.css,
       js/community.js, js/composer.js, js/dm.js, js/mywork.js, sw.js.

   v76 — the site's own wording is no longer copyable. Headings, button
       labels, nav, hints and stat labels could all be long-pressed on a
       phone or drag-selected on a desktop, which put the whole interface
       one gesture away from being lifted wholesale. css/select.css (new)
       turns selection off at the root and opts back in, by selector, only
       the text a person actually typed: artwork title and description,
       usernames and handles, bios, comments, album names, direct
       messages, community posts, and the blog / jobs / resources /
       marketplace bodies. Every form field stays selectable, so nothing
       about typing, editing or the copy-link buttons changes.
       CSS alone stops the gesture but not the shortcut, so js/protect.js
       also guards the copy and cut events: it walks the text nodes a
       selection actually covers and refuses the clipboard if any of them
       is unselectable. That closes select-all-then-copy and
       find-in-page-then-copy, which reach the clipboard without ever
       showing a selection. It asks the computed user-select value rather
       than keeping a second list, so css/select.css stays the only place
       the policy is written down.
       Not covered, because no page script can: view-source, devtools and
       reader mode. Those need the wording gone from the HTML, not
       guarded in it.
       Changed: css/select.css (new), js/protect.js, index.html, sw.js.

   v75 — grid thumbnails go responsive. t300 was the only grid size and
       the grid is not 300px wide on a desktop: .fgGrid runs four columns
       across the full viewport with no cap, so a 1920px screen laid each
       cell out at ~480 CSS px and upscaled the 300px file 1.6x, or 3.2x
       on a high-DPI panel. A new t600 (600px, q0.52) joins the set and
       the artwork grids now emit a srcset of 300/600/1000 with a sizes
       string matching the 2/3/4-column breakpoints, so the browser picks
       per screen. f1600 is kept out of the candidate list — it is the
       download size, and a 4K screen pulling it per cell would cost more
       egress than the blur it fixes is worth.
       Effective DPR is capped at 2: uncapped, a DPR-3 phone asks for
       645px and takes v1000 (~60KB) over t600 (~28KB) for a difference
       invisible at that physical size.
       SB_THUMB_RE now covers t600 so the new size caches beside t300
       rather than falling through to the network every time.
       t600 did not exist for anything uploaded before it was added, and a
       srcset candidate that 404s fails the image rather than falling back
       to another entry, so every path that can emit one is gated on
       T600_READY — config.js for the client, Pages env for the worker,
       and they have to be set together or the server-rendered homepage
       cards disagree with the client that hydrates over them.
       The backfill itself is DONE: all 30 existing images have a t600, 0
       missing and 0 orphaned. It ran inside Supabase rather than through
       security/backfill-t600.mjs, because no Node was available — see
       supabase/functions/backfill-t600/index.ts. So the flag is now the
       only thing standing between this code and the responsive sizes.
       Changed: js/app-core.js, js/profile.js, js/albums.js, js/mywork.js,
       js/sections.js, js/startup.js, sw.js, functions/_middleware.js,
       _middleware.js, functions/api/download.js,
       supabase/functions/smart-function/index.ts,
       security/backfill-t600.mjs (new), config.example.js.

       Also in v75, unrelated to the above: the download tier copy now
       says plainly which tiers get the untouched original. The rule is
       unchanged — Premium, Max and dev take the original, Free and Lite
       take the public 1600px derivative — but Lite advertised only
       "high-quality exports", which read as though the entry tier bought a
       better file rather than a bigger allowance. Lite's card and the
       plan overview now name the 1600px size and say originals need
       Premium. index.html and aiAssistantData.js precache with no ?v= of
       their own, so they ride CACHE_VERSION.

   v74 — every upload button now records itself in its own table.
       Eight media tables existed but nothing read or wrote them, so they
       sat empty while the app kept using the flat columns. Uploads now
       dual-write: the flat column stays the source of truth for display,
       and a row goes into the table that belongs to that button —
       artwork_image / artwork_file, resources_image / resources_file,
       marketplace_image / marketplace_file (new, the set was missing it),
       blog_image, profile_image, profile_banner_image.
       Writes are fail-soft on purpose. The publish has already happened
       by the time these run, so a bookkeeping error is logged, never
       thrown. Changed: js/app-core.js, js/upqueue.js, js/avatar.js,
       js/sections.js.

   v73 — storage migration finished, so the CloudFront half comes out.
       The resizer host and its /fit-in/<w>x0/ cache rules are gone;
       every image is a Supabase Storage object now, and SB_THUMB_RE /
       SB_VIEW_RE already cache the two sizes that matter, so no
       caching is lost with them.
       The version bump matters more than usual here. A client holding
       the pre-migration bundle would keep asking smart-function for an
       S3 presigned PUT that it no longer returns, and would keep
       requesting CloudFront urls that are about to stop resolving.
       Refilling every cache is what retires those clients.

   v71 — storage migration, phases 1-3. Media is moving off S3 +
       CloudFront onto Supabase Storage, in stages, with both hosts
       serving at once so nothing breaks mid-move.
       Two buckets: koe-media stays public and unchanged for display
       derivatives, avatars and banners (all eleven of its existing
       policies intact); a new private koe-originals holds artwork
       originals and paid asset files, reachable only through a signed
       url minted after the daily quota is spent.
       Sizes are now generated once at upload rather than resized on the
       fly, because Supabase image transformations are a paid-plan
       feature and this must work on Free. Each size is its own object,
       distinguished by a filename suffix — __t300 / __v1000 / __f1600 —
       and the size sits in the filename rather than a path prefix so
       koe-media's foldername[2] = auth.uid() policies keep working.
       imgResize, the edge middleware and the sitemap all dual-read: a
       CloudFront url still resizes on the fly, a Supabase url swaps the
       suffix. Correct whether or not a given row has been migrated.
       The SW previously skipped every Supabase host, which after the
       move would have meant zero caching for images and the largest
       possible metered egress. Public storage objects are now cached by
       size, thumbs and lightbox views, while rest/auth/realtime stay
       uncached as before.
       scripts/migrate-storage.mjs copies the objects across, pulling
       each derivative from the resizer distribution being retired so
       nothing is re-encoded. Must run before that distribution is
       disabled.
       Changed: js/app-core.js, sw.js, functions/_middleware.js,
       _middleware.js, functions/sitemap.xml.js,
       scripts/migrate-storage.mjs (new),
       security/storage-migration.sql.

   v70 — artwork downloads are metered per day and no longer reachable
       any way except the Download button. The button now posts to
       /api/download, which spends a quota unit through
       dz_request_download and streams the file back from our own
       origin as an attachment, so the raw CDN url never reaches the
       browser. /api/* is POST-only here and the SW ignores non-GET, so
       nothing new is cached. js/protect.js joins the shell: it kills the
       long-press / right-click image menu, image dragging and the save
       page shortcut, and base.css carries the matching -webkit-touch-
       callout rules.
       The subscription page states the numbers instead of hinting at
       them: a Free 5 / Lite 10 / Premium 15 / Max 20 per-day strip above
       the plan cards, the reset time and the resolution difference in
       writing, and each card's first bullet is its own daily count. The
       old copy said "download limited assets" and "more downloads per
       month", which was both vague and, after this change, wrong.
       base.css, viewer.css, panels.css and gallery.js all changed, so
       their ?v= moved with them.
       /api/download only answers requests that carry a same-origin browser
       signal, and it refuses expired or malformed tokens by reading the JWT
       locally before it spends a Supabase roundtrip. Attempts are capped at
       30 a minute per account and 60 per IP, so a script cannot run the bill
       up on refusals after the daily quota is gone.
       Bytes no longer come from a public url at all. /api/download asks
       smart-function for a source, and that function mints a short-lived
       presigned S3 GET only after the quota has been spent — the gate sits
       beside the AWS credentials, so a signed url cannot exist without a
       download having been charged. Paid tiers get the original that way;
       free tiers get the public resized derivative the image CDN already
       serves for display. This is what lets the origin bucket stop being
       world-readable, so the three remaining places that pointed at the
       stored original now point at the resized copy instead: the sitemap's
       <image:loc>, the client og:image / twitter:image / JSON-LD, and the
       My Work edit-form thumbnail. Display, thumbnails and avatars already
       went through the resizer and are untouched.
       A second sweep caught the rest of the readers of the stored original,
       all of them crawler-facing: the JSON-LD contentUrl the edge middleware
       writes for the gallery and for each artwork, 37 hardcoded URLs in the
       static ldGallery block in index.html, and the blog cover download link.
       All now resolve through the resizer, so locking the origin bucket
       cannot cost image-search indexing. Nothing in the repo references the
       origin host any more.
       Changed: index.html, js/gallery.js, js/mywork.js, js/sections.js,
       js/protect.js (new), css/base.css, css/viewer.css, css/panels.css,
       functions/api/download.js (new), functions/sitemap.xml.js,
       functions/_middleware.js, _middleware.js,
       supabase/functions/smart-function/ (new, mirror of the deployed v16),
       security/daily-download-quota.sql (new, record only).

   v69 — the precache was covering URLs nobody asks for. Every tag in
       index.html carries a query string (/css/base.css?v=1) while
       SHELL_URLS listed the bare path (/css/base.css), and cache.match
       keys on the full URL including the search, so 38 of the 41 shell
       assets were precached under a name the page never requests. They
       missed on every first load and only got cached once a network
       fetch had already succeeded — which is the one thing precaching
       exists to avoid, and it left a freshly installed client with no
       usable CSS or JS if it went offline before a full load. The list
       now mirrors the tags exactly. When you change a shell file, bump
       its ?v= in both index.html and here — they have to move together.
       Changed: sw.js.

   v68 — three quick links repointed at the page each one actually
       belongs to. Level was opening the ranking board of the same name;
       it now opens Artist Progress, the profile's own level page, and
       clears the last-viewed profile first — that page targets whoever
       you looked at most recently, so without the reset a quick link
       would show someone else's level. Ranking takes over the full
       boards, the page the hero strip's VIEW FULL RANKING leads to,
       instead of scrolling down to that strip. Subscription and Theme
       already opened the same pages Settings does and are unchanged.
       closeXpPage joins the sweep, since Artist Progress hides the
       bottom bar while it is up and bnCloseAllSections does not know it.
       Changed: index.html, js/sections.js.

   v67 — quick links land in the right place. Tapping one opened the
       right thing but not where it belongs: Cart showed the cart panel
       with the section tab strip still scrolled to Artworks, so its own
       tab sat off-screen and there was no sign of which section you
       were in, and the bottom bar still lit Home. qlGo called openFG()
       and the bare open* functions, which are the raw openers —
       bnGoGallery / bnGoUpload are the real entries and additionally
       close whatever else is open, reset the category filter and set
       the nav highlight. Community was already routed through
       bnGoCommunity, which is why it alone behaved. Every destination
       now goes through the same door, and Subscription, Level, Theme
       and Ranking close open overlays first. fgSwitchSection also
       scrolls the active tab into view, so arriving from a quick link
       or the hero CTA shows where you are.
       Changed: index.html, js/sections.js, js/gallery.js.

   v66 — the quick links rendered unstyled on a first load after v65 on
       some browsers: giant SVGs, title and description running together
       on one line, grey default button chrome. Nothing wrong with the
       CSS — the page was being served the previous hero.css. Navigations
       are network-first, so index.html is always fresh, but same-origin
       assets are stale-while-revalidate, which hands back the cached copy
       and only then refetches. New markup therefore paints against last
       release's stylesheet, and the fix does not land until a second
       reload. Every asset in index.html was pinned at ?v=1 and had never
       been bumped, so the URL never changed and the cache entry never
       missed. hero.css and sections.js now carry ?v=65, which is a cache
       key the old shell cannot hold, so the very first load after a
       deploy gets the matching pair. SHELL_URLS carries the same two
       query strings so the precache still covers what the page asks for
       (the other entries there are still unversioned, matching their
       tags). Bump the ?v= on any shell file you change from here on.
       Also drops color-mix() out of the quick links: the light theme now
       carries a spelled-out --qlL per item and the progress track uses
       rgba(), so browsers older than Chromium 111 / Safari 16.2 get the
       same result instead of a washed-out or invisible one.
       Changed: index.html, css/hero.css, sw.js.

   v65 — homepage quick links. A row of twelve icon + title +
       description shortcuts now sits between the hero pitch and the
       search bar, split into two halves of six: browse (Artworks,
       Marketplace, Resources, Blog, Jobs, Community) then yours
       (Upload, Ranking, Level, Subscription, Cart, Theme), so a large
       desktop shows one whole half per screen. It is a snap scroller
       whose slot count follows the device and never leaves 2–6: 2 mobile,
       3 large mobile, 4 tablet, 5 desktop, 6 large desktop, and 6 on
       ultrawide with the row capped and centred rather than stretched.
       Icons sit in a fixed box and descriptions reserve two lines, so
       titles and card heights line up whatever the copy does. A thin
       line under the row tracks scroll position and hides itself when
       nothing overflows. The icon hues are picked against near-black,
       so the light theme darkens them and the progress track is tied
       to the text colour — otherwise lime and cyan sat near 1.4:1 on
       #F6F6F9. Every theme now clears 4.5:1 on text and 3:1 on icons.
       Changed: index.html, css/hero.css, js/sections.js.

   v64 — homepage feed is pure trending. renderAwGrid ran the trending
       sort and then tgPrioritize() pulled every artwork matching a
       saved tag preference to the front, so the homepage order did not
       match the gallery's. The call is gone; both now use the same
       sortByTrending. tgPrioritize and tgAfterChange were its only
       users and are removed with it. Changed: js/search.js,
       js/tagrail.js.

   v63 — comments across the codebase reduced to short keyword labels,
       site description rewritten in plain wording, and the U+2726
       sparkle dropped where it was punctuation in toasts and buttons.

   v62 — homepage: the chip rail and the Artworks/Latest/category tab
       strip are gone. The search bar is now the last thing above the
       feed, so artwork starts immediately under it on every device.
       The tag rail survives in the Full Gallery overlay only.
       index.html changed substantially — every client must drop the
       old shell.

   v61 — security hardening. The artwork upload now forwards a server-
       signed moderation approval token (mod_token) on both the direct
       and scheduled publish paths, so the DB-side moderation gate can
       verify a real moderation pass before an insert is trusted as
       approved. Changed: js/upqueue.js.

   v60 — artwork dropzone matches the new picker. The artwork upload's
       drop target now uses the same anatomy as the section forms: the
       Artworks gradient mark instead of the ⬆ emoji tile, a "Select
       image" action in place of "📁 Choose Files", the accepted
       formats as a spaced caption, and the roomier padding. The extra
       pages zone follows, keeping its per-mode emoji (📖 / 🖼).
       Changed: index.html, css/upload.css.

   v59 — section upload file picker. The Resources / Blog / Marketplace
       forms used the browser's bare "Choose file" control; each file
       field is now a dropzone matching the artwork page — drag & drop,
       a Select image / Select file action, the accepted formats, and
       the picked file shown back with a thumbnail (or its extension),
       size, Replace and Remove. The tile carries that section's own
       gradient icon, the same mark the gallery rail and upload tabs
       use. Roomier padding and field spacing throughout the picker.
       Changed: js/sections.js, css/hero.css. Both already ship in the
       shell, so this bump is what gets them to existing clients.

   v58 — upload page side margin 8% → 10%. Laptop and up (PC, desktop,
       ultrawide, TV) now leave 10% of the viewport empty on each side
       of the single column. css/upload.css only.

   v57 — upload page is one column. The upload page rendered as three
       side-by-side columns on desktop (media | fields | sidebar) and
       paired Category with Tags; everything now stacks one item per
       line at every width, including the action buttons. No width cap
       on the page any more — big screens get an 8% empty margin down
       each side instead, so the column grows with the screen. The
       section forms (Resources, Blog, Marketplace, Jobs) lose their
       form-plus-sidebar split the same way, and their SCHEDULED /
       SAVED DRAFTS strips are now the artwork rail itself: the same
       scrolling .upDraftRow of square .upDraftCard tiles with the
       top-left ✕ and the corner expiry / countdown mark, only filled
       with text instead of a thumbnail (a section draft has no image).
       Changed: css/upload.css, css/overrides.css, js/sections.js.
       This bump is what gets the new CSS to clients that already have
       the old stylesheets in the shell cache.

   v39 — section schedule + drafts. The section forms (Resources, Blog,
       Marketplace, Jobs) now match the artwork upload: a two-column
       layout with a sidebar (SCHEDULED strip, SAVED DRAFTS strip,
       Upload Guidelines, Tips), the Reset button replaced by 💾 Save
       Draft, and a Schedule field using the same custom calendar the
       artwork upload uses. Scheduling is fully server-side, mirroring
       artworks: the built row + its S3 files are parked in the new
       public.scheduled_sections table and a five-minute pg_cron
       (publish_due_scheduled_sections) inserts it into the real table
       at the set time, so a post goes live even with the device off.
       Drafts are device-local (IndexedDB 'dzsecdrafts'), text + tags
       only, auto-purged after 7 days. Drafts and scheduled posts show
       as text-first cards (.dzPCard) — status badge, title, excerpt,
       meta — since these posts are words, not thumbnails. Changed:
       js/sections.js, css/overrides.css. Backend applied separately.

   v38 — upload selects skinned. The section forms (Resources, Blog,
       Marketplace, Jobs) shipped native Chrome <select> boxes —
       .dzSel — and the schedule hour/minute (.upSchedSel) did too, so
       they stuck out grey and system-font next to the artwork upload's
       custom controls. css/overrides.css gains a § UPLOAD SELECTS +
       CALENDAR block giving both the same appearance:none + SVG chevron
       + theme-token option list that select.upIn already uses, so they
       now read identically to the artwork upload. The Jobs date field's
       calendar glyph is dimmed until hover/focus; its popup already
       follows color-scheme. One file changed, loads last, nothing else
       touched.

   v37 — title colour. Removing the star in v36 took the only accent
       colour out of every heading, so the accent moves onto the words:
       css/overrides.css gains a § TITLE COLOUR block setting .secT,
       .subPgTitle, .subPgHeadline h2, .faqTitle, .apTitle, .apDescTitle,
       .spTitle, .cpTitle, .albModTitle, .tgModTitle, .pfShareTitle,
       .fltPH h3, .upDraftTitle, .dmConvoHead, .cLbl and .xpRankTitle to
       var(--pg). It is the theme token, not a fixed purple, so Light and
       the mono themes follow their own accent. .fgTitle and .cmHdrTitle
       keep their gradient — they stay the top tier. One file changed,
       and it already loads last, so nothing else needed touching.

   v36 — heading stars removed. The decorative four-pointed star that
       sat in the <span class="s"> slot after almost every page and
       section title is gone: Gallery, Profile, Upload, Community,
       Ranking, Subscription, Settings, Albums, Bookmarks, Friends,
       Filters, Sponsor, Admin, Drafts, Share Profile, Tags, the FAQ
       and Choose Your Plan headings, the LET'S CONNECT divider, the
       MESSAGES conversation head and the footer logo mark. Titles
       built in JS lose it too — album name / rename / new album
       (js/albums.js), the Likes-Bookmarks page head (js/engagement.js)
       and the XP rank title (js/misc-core.js). The .s rules stay in
       CSS because four non-star markers still use them: Edit My Work,
       Notifications, Account and Theme. Four shell files changed, no
       new paths, so this bump is purely to pull returning visitors
       off the stale cached copies.

   v35 — scroll-reveal deleted. The .fu-el rise (opacity 0 + 50px,
       850ms, staggered 80ms per card) is gone from artworks, ranking,
       subscriptions and connect — not gated, removed. js/effects.js
       loses its last module entirely, 192 lines, taking with it the
       IntersectionObserver and the MutationObserver that re-scanned
       every grid re-render; the .fu-el rules go from css/connect.css
       and the 24px rank-card variant from css/ranking.css. A stale
       cached effects.js can no longer hide anything, because nothing
       stamps the class and no rule acts on it. The stale note in
       js/startup.js describing the restamp is corrected. Four shell
       files changed, no new paths.

   v34 — hero motion stripped + connect links. The hero pitch no longer
       fades and rises 14px on every tab switch, the CTA no longer lifts
       on hover, and the floating badge / bell / Zeo button now cut in
       and out instead of sliding down 8px with a 250ms fade. Their
       translateZ(0) layer promotion stays — that's the iOS Safari
       white-flash fix, not decoration. In #connect, YouTube is gone and
       X is in at the new @DigiArtzHQ handle, leaving X / Instagram /
       Website / Email. No new precache paths; index.html, base.css and
       hero.css all already ship in the shell, so this bump is purely to
       get returning visitors off the stale copies.

   v33 — v32 shipped index.html and this file without the three /js
       badwords files, so the page requested scripts that 404'd and the
       filter never ran. This bump exists to re-run install once those
       files are actually there, otherwise clients that took v32 keep a
       shell that never precached them. Also strips the third-party
       source name out of the note below — that credit now lives in
       ATTRIBUTIONS.md at the repo root, which is where it has to stay:
       the word list is CC BY 4.0 and attribution is a condition of use.

   v32 — profanity + link mask. Three new files in /js: two word-list
       files (badwords-list-a/b.js, 2,536 entries across 27 languages)
       and badwords.js, which wraps supabase.createClient() so every
       insert/update/upsert/rpc gets masked on the way out. All three are
       precached below — the engine is useless without its lists, so an
       offline client must never hold one and not the others. index.html
       changed too (the three new script tags). Numbers are deliberately
       NOT filtered: order and payment references, image IDs and
       timestamps all live in that space. badwords-review.js is NOT
       precached — it ships nothing active and is only loaded if a
       held-back word gets switched on.

   v31 — follow-up to v30: the retired AI Art category was still
       reaching the tag rail. tgLabel() falls back to the raw slug for
       anything it has no label for, so dropping it from SITE_CATEGORIES
       turned the chip into a bare lowercase "ai-art" instead of hiding
       it. The rail feeds from get_top_tags() and saved user_tag_prefs,
       neither of which goes through catList(), so both are now filtered
       through a shared catHidden() predicate. The lightbox tag chips
       are guarded the same way.
   v30 — AI Art category retired from the UI and Zeo relabelled as a
       bot. The 18 artworks already tagged ai-art keep the value in the
       database; catList() just filters it out of every chip, filter and
       picker, so nothing is orphaned and the change is one line to
       revert. Zeo's badge and labels now read Bot instead of AI. The
       report reason and the upload rejection wording are unchanged.
   v29 — album privacy + per-tier cap. Like/Bookmark profile tabs are
       gone (saved artwork is private now); every album card gets a
       3-dot menu — Rename / Public-Private / Delete — with Likes and
       Bookmarks toggleable but never renameable or deletable. Album
       cap moved from a flat 100 to 25, or 30 on premium/max. Needs the
       album_visibility_and_tier_cap migration. css/widgets.css gains
       the menu styles; no new precache paths.
   v28 — resource / blog / marketplace image moderation. Gemini now
       gates Resources + Marketplace uploads (resource mode, MATURE
       allowed, AI previews rejected) and Blog covers (artwork mode),
       all through the same #upqBackdrop tracker artworks use. profile.js
       gains Resources / Blog / Marketplace tabs. No new precache paths —
       every changed file already ships in the shell — so this bump only
       forces returning clients onto the new JS.
   v27 — new favicon. Site icons regenerated from the DigiArtz bird
       logo (replacing the old "D"). Tab favicons now ship a dark-mode
       white variant switched by prefers-color-scheme in index.html;
       favicon-32x32.png is in the precache below, so this bump is what
       forces returning visitors off the stale cached icon. The 16/48
       and -dark variants cache lazily on first request.

   v26 — split shell. index.html's inline <style> and <script> blocks
       now live in /css (13 files) and /js (25 files); all 38 are
       precached alongside the shell so the first offline open still
       has the full site. uploadVerifier.js joins the precache list
       too — it was always part of the shell but only cached lazily.

   v25 — full-page + fit-first-screen. #artModal backdrop padding
       zeroed and the .avBox card fully flattened on every width (the
       old 2rem/.7rem paddings and min(1400px,94vw) card made it a
       box on desktop/tablet); viewer + stack + detail images now
       scale to calc(100dvh − 132px) so the whole image fits the
       first screen on any device, centered with side space.

   v24 — viewer spacing. Share is back as the last wide action after
       Download/Report; viewer + detail images are centered with
       clamp(1rem,5vw,3rem) side space and a 1100px cap instead of
       edge-to-edge.

   v23 — boxless viewers + FOUC fix. Viewer top bars are plain-text
       Previous/Next only (close = browser back or Escape); zoom bar,
       counter, close button and top icon row removed; images render
       directly on the page full-width with no stage/letterbox — in
       #dzView too, which now closes via the back button (history
       entry). 19 load-visible inline SVGs got width/height attributes
       so nothing flashes giant behind the transparent veil before the
       late stylesheet parses.

   v22 — cache resync. v21 shipped ahead of its index.html, so the
       v21 shell cache holds the OLD page; this bump forces every
       client to drop it and pick up the payments/detail-view/veil
       build in one visit instead of two (stale-while-revalidate).

   v21 — loading veil. The intro splash (logo, particles, progress
       bar, 2.8s minimum) is replaced by a transparent centered
       spinner + LOADING text. It blocks all input (see-through, not
       pass-through) and drops the instant the same tracked slices
       finish — zero minimum display time; 9s hang failsafe kept.

   v20 — detail views. Artwork viewer is a full-page single column:
       Previous top-left, Next top-right, all images stacked, author →
       details → NEW per-item comments (item_comments) → Download →
       Report; prev/next now clears image/title/like state instantly
       (data-id + synchronous engagement repaint). New #dzView overlay
       gives Resources/Blog/Marketplace/Jobs the same full-page detail
       treatment — comments on all but Jobs, Buy card top of the
       marketplace page, report everywhere (item_reports).

   v19 — desktop polish. ≥1280px layer at the end of <body>: grids
       capped at 1680px and centered (4 cols on small laptops, 5 at
       1440px+, wider gaps on ultrawide), 15px card titles and body
       copy, 12.5px meta, all primary buttons ≥46px tall with 14px
       labels. Mobile untouched.

   v18 — checkout + subscription revamp. Three-card plan
       grid (Premium featured), checkout for plans and
       marketplace items via a Pages Function, buy/download
       buttons on marketplace cards, and the download button now asks
       dz_request_download() for tier quota + quality before opening
       the file. /api/* and the provider's own script host are
       runtime-only and never cached: the endpoint took POST (which the
       SW ignores), and the provider script is cross-origin, outside the
       cached hosts below.

   v17 — gallery becomes six sections; hero slides removed.
     - Gallery: Artworks / Resources / Blog / Marketplace / Jobs /
       Cart tabs (colour icon chips), one search bar per section with
       the filter riding at its tail, and per-option filter icons.
       The old SEARCH ARTWORK row (#fgQ) is gone.
     - Sections are live: resources, blog_posts, marketplace_items
       and jobs tables in Supabase; Resources/Marketplace files go to
       S3 under koe-media/resources/ and koe-media/market/ via the
       s3-sign edge function (now v14, ext-gated up to 200MB). Those
       downloads are fetched on explicit save only, so this worker
       deliberately does NOT cache them.
     - Upload page: What-are-you-posting rail (Artwork keeps its
       original form; Resources/Blog/Marketplace/Jobs forms are
       spec-generated; tags everywhere).
     - Hero banner slides deleted end to end: #topSlide strip + dot
       bar, #tsPage detail dialog, admin editor, hero_slides table,
       and the hero-slides/ signing prefix. 640 lines out.
     - In their place: the segmented hero pitch (Explore / Learn /
       Buy / Sell) — headline with brand-red highlight (--brand-red
       token, shared with the logo badge), checklist, CTA wired to
       the real surfaces, fade-and-rise per swap.
     - Section tab tap targets raised to ~47px; horizontal rails get
       overscroll containment.
   index.html changed substantially — every client must drop the
   old shell.
   v16 — sub-pixel fix in the tag rail packer. It measured chips with
   offsetWidth, which rounds to a whole pixel; with real webfont
   metrics a chip laying out at 86.4px reported 86, so ~16 chips
   under-counted a row by several px and the rail scrolled on desktop
   by exactly that much at roughly one width in three. Now measured
   with getBoundingClientRect, plus 1px of headroom because
   scrollWidth rounds up. Also: the All chip sticks at its inset
   instead of the raw scrollport edge, chip and clear-button touch
   targets grow into the row gutter, and hover states sit behind
   @media(hover:hover) so they can't stick after a tap.
   v15 — tag rail rebuilt, album tiles squared, thumbnail clip fixed.
     - Tag rail: a live artwork search bar over TWO chip rows instead
       of three. The bar filters the feed as you type (title,
       description, tags, category by slug and label, artist); the
       pinned "All" chip opens the tag grid. Rows pack to one
       desktop's worth of tags on every device, so a phone scrolls
       sideways to the same vocabulary a desktop shows at once.
       Picked tags now STAY on the rail, filled with the accent
       colour, instead of rotating out of sight.
     - Albums: the card is a square. The 2×2 cover mosaic fills it
       edge to edge and the name + item count sit inside at the
       bottom over a scrim. Grid columns and gaps now match
       .pfGridArt exactly. Creating an album lives on one surface
       only — the manager page, first tile.
     - Thumbnails: .admCardThumb gives Edit My Work cards their own
       square clip. thumbStyle()'s transform:scale() was painting
       outside its box and covering the title and the Edit/Delete
       row, which made zoomed cards look like tall blurry images
       with no controls.
   v14 — featured-strip caption resized. Title is now ~40% of the
   banner height and a two-line description sits under it, together
   filling ~60%. Both are measured in container units (cqh) so the
   proportion holds whether one slide is showing or four.
   v13 — albums, tags and featured-strip rework (supersedes v12,
   which covered the same work mid-flight).
     - Albums: profile tab, Settings manager, album detail page and
       an optional multi-select picker on upload. Likes and Bookmarks
       show up as virtual albums.
     - Tags: a chip rail under the hero plus a second one in the
       gallery (both share state), per-user preferences that BOOST
       feed order without ever filtering, and a tag search grid.
     - Featured strip: 1/2/3/4 slides per view by breakpoint, snap
       carousel with arrows + dots, a large two-line title, and a
       tap-through detail page (image, title, description, date).
     - Fixes scheduled uploads, which were publishing immediately
       because publishAt never reached the upload job.
   index.html changed substantially — every client must drop the
   old shell.
   v11 — upload session reset: a finished upload now clears every
   scrap of form state (files, focal point/zoom, preview, fields,
   schedule, draft link) so the next piece starts clean.
   v10 — upload page rebuild: full-page Upload destination (guest-
   viewable), thumbnail zoom (thumb_zoom), device-local Drafts,
   server-side Scheduled uploads, draft/schedule preview modal and
   the custom themed date picker. index.html changed substantially,
   so every client must drop the old shell.
*/
'use strict';

const CACHE_VERSION = 'v103';
const SHELL = `dz-shell-${CACHE_VERSION}`;
const THUMB = `dz-thumb-${CACHE_VERSION}`;
const VIEW  = `dz-view-${CACHE_VERSION}`;
const FONT  = `dz-font-${CACHE_VERSION}`;
const KEEP  = [SHELL, THUMB, VIEW, FONT];

// cap each image cache
const LIMITS = { [THUMB]: 60, [VIEW]: 50, [FONT]: 20 };

// precached shell
const SHELL_URLS = [
  '/',
  '/index.html',
  '/config.js',
  '/uploadVerifier.js',
  '/aiAssistantData.js',
  '/site.webmanifest',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-192.png',

  // stylesheets
  '/css/base.css?v=4',
  '/css/hero.css?v=76',
  '/css/viewer.css?v=4',
  '/css/community.css?v=3',
  '/css/connect.css?v=1',
  '/css/ranking.css?v=2',
  '/css/profile.css?v=3',
  '/css/admin.css?v=1',
  '/css/auth.css?v=1',
  '/css/panels.css?v=2',
  '/css/upload.css?v=1',
  '/css/widgets.css?v=1',
  '/css/overrides.css?v=1',
  '/css/select.css?v=1',

  // word list goes with the engine
  '/js/badwords-list-a.js?v=1',
  '/js/badwords-list-b.js?v=1',
  '/js/badwords.js?v=1',

  // scripts
  '/js/ranking.js?v=2',
  '/js/community.js?v=2',
  '/js/dm.js?v=4',
  '/js/composer.js?v=2',
  '/js/share.js?v=1',
  '/js/misc-core.js?v=5',
  '/js/app-core.js?v=10',
  '/js/protect.js?v=2',
  '/js/gallery.js?v=68',
  '/js/auth.js?v=3',
  '/js/profile.js?v=4',
  '/js/albums.js?v=3',
  '/js/drafts.js?v=1',
  '/js/upqueue.js?v=2',
  '/js/avatar.js?v=2',
  '/js/pfedit.js?v=5',
  '/js/mywork.js?v=6',
  '/js/startup.js?v=2',
  '/js/tagrail.js?v=2',
  '/js/search.js?v=2',
  '/js/feed.js?v=2',
  '/js/effects.js?v=5',
  '/js/legal-content.js?v=1',
  '/js/cookie.js?v=1',
  '/js/zeo.js?v=1',
  '/js/theme.js?v=2',
  '/js/engagement.js?v=3',
  '/js/sections.js?v=78',
  '/js/navprogress.js?v=5'
];

// hosts
const API_RE       = /^\/api\//;
const SUPABASE_RE  = /\.supabase\.co$/;
const FONT_RE      = /^fonts\.(googleapis|gstatic)\.com$/;
const BYPASS_RE    = /(googletagmanager|google-analytics|googlesyndication|doubleclick|cloudflareinsights)\./;

// Supabase Storage public objects. Migrated images live here, and each size is
// a separate object identified by a filename suffix rather than a resize path.
// These MUST be cached: Supabase egress is metered, so an uncached thumbnail
// grid is the most expensive thing the site can do. Everything else on the
// Supabase host (rest, auth, realtime) stays uncached.
const SB_OBJECT_RE = /^\/storage\/v1\/object\/public\//;
const SB_THUMB_RE  = /__(?:t300|t600)\.webp$/;
const SB_VIEW_RE   = /__v1000\.webp$/;

// install, precache the shell
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

// activate, drop stale versions
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('dz-') && !KEEP.includes(n))
           .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// trim to cap, oldest first
async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

// cache first
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.type === 'opaque' || res.ok)) {
      await cache.put(request, res.clone());
      // fire and forget eviction
      trim(cacheName).catch(() => {});
    }
    return res;
  } catch (err) {
    const stale = await cache.match(request, { ignoreVary: true });
    if (stale) return stale;
    throw err;
  }
}

// stale while revalidate
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // get only
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // migrated images, cached by size. checked before the Supabase skip below,
  // which is there for rest/auth/realtime and would otherwise cover these too
  if (SUPABASE_RE.test(url.hostname) && SB_OBJECT_RE.test(url.pathname)) {
    if (SB_THUMB_RE.test(url.pathname)) { event.respondWith(cacheFirst(req, THUMB)); return; }
    if (SB_VIEW_RE.test(url.pathname))  { event.respondWith(cacheFirst(req, VIEW));  return; }
    return;   // other sizes, no cache
  }

  // skip live data
  if (SUPABASE_RE.test(url.hostname) || BYPASS_RE.test(url.hostname)) return;

  // Pages Functions, never cached. This used to be covered by accident — every
  // endpoint took POST and the handler above ignores non-GET — but one of them
  // now answers GET with per-caller content behind a session check. Caching it
  // would hand a signed-in answer to whoever asked next, and a signed-out 401
  // to someone who has since signed in. Straight to the network, always.
  if (url.origin === self.location.origin && API_RE.test(url.pathname)) return;

  // navigations, network first
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match(req)) ||
               (await cache.match('/index.html')) ||
               (await cache.match('/')) ||
               Response.error();
      }
    })());
    return;
  }

  // google fonts
  if (FONT_RE.test(url.hostname)) {
    event.respondWith(cacheFirst(req, FONT));
    return;
  }

  // own static assets
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});

// skip waiting message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
