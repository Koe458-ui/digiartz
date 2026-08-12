/* service worker, offline cache
   caches: shell, thumbs, lightbox images, fonts
   supabase, analytics and ads are never cached
   bump CACHE_VERSION to refill every client

   changelog
   v172 — one dashboard per section, ten rows a card, one gap.
       The scope tabs are gone. Artwork Analytics is artworks and
       nothing else: the row tapped in Settings is the dashboard you
       get, and no control on the page turns it into another one.
       Artwork Performance and Latest On Your Work show ten. Both carry
       a View all that opens a page of their own with the whole list —
       the same rows, the same sort buttons, no cap — sitting over the
       dashboard so closing it puts you back where you were. The reader
       returns 100 activity rows now rather than 12, because the page
       behind View all needs more than the card asks for.
       Spacing between boxes was a margin on whichever card happened to
       need one, which is how two boxes end up touching. Every section
       body is a flex column with one gap now, --an-gap, and every grid
       on the page reads the same variable. No card remembers anything.
       Changed: index.html, js/analytics.js, css/analytics.css, sw.js,
       and a migration.
   v171 — the other three sections start counting views, and a view
       stops being an edit.
       v170 recorded item views in item_view_dedup and left the three
       view_count columns alone, reasoning that the touch trigger and
       the edit rate limiter made a bump impossible. That was wrong:
       artworks carries the same two triggers and has bumped its
       counter since the day it was written. What is true is that both
       triggers treat a counter bump as an edit, and both are wrong to.
       dz_write_rate no longer charges a view to the VIEWER's edit
       budget — 120 an hour, after which their views were dropped and
       their next real edit refused. dz_touch_updated_at no longer
       restamps the row, so an artwork stops reading "Updated 2 minutes
       ago" every time a stranger looks at it. Both were already true
       of artworks.
       Trying it turned up something bigger. blog_posts,
       marketplace_items and resources carry CHECK constraints added
       NOT VALID, and a CHECK is re-evaluated against the whole row on
       every UPDATE — so a row written under the old bounds could not
       be updated at all, in any column, by anyone. Every row in those
       two tables was frozen: a 56-character blog body against a 100
       minimum, a 19-character listing description against the same.
       Their owners could not save an edit and moderation could not
       change a status. Those bounds are triggers now, checked when the
       field is written rather than when the row is touched — the same
       rule on insert and on update, and nothing accepts content the
       form would reject.
       view_count is a cache of item_view_dedup and is written last, in
       its own block, so a constraint added tomorrow costs a number on
       a card rather than a real view.
       Changed: a migration only.
   v170 — marketplace, blog and resources get the same dashboard.
       Settings gains an Analytics group with four rows in order:
       Artwork, Marketplace, Blog, Resources. One page, four scopes,
       switchable by tabs at the top without leaving it.
       One rule decides most of this: a number appears in the section
       it came from and nowhere else. A like on an artwork is one like
       under Artworks and zero under the other three; a post's five
       likes are five under Blog and zero elsewhere. cred is the one
       thing that cannot be split — profile_creds has a giver, a
       receiver and a time and no subject, because cred is given to a
       person on their profile, not to a piece of work — so it stops
       being reported as a section metric and moves to an account
       block that says what it covers. Shares take its place in the
       KPI row, and on the marketplace Downloads reads Sales.
       The other three sections had no views at all: their view_count
       columns existed and nothing had ever incremented them.
       item_view_dedup and register_item_view are that missing half,
       and they do not touch the item tables — all three carry a touch
       trigger and an edit rate limit on UPDATE, so counting a view
       there would restamp updated_at and spend the viewer's own edit
       budget. Five normalised views (an_item, an_view, an_like,
       an_bookmark, an_download) give the readers one shape for four
       sections.
       Marketplace alone gets a Revenue section, from
       marketplace_earnings. Goals and achievements are per dashboard
       now — "500 views in 30 days" means something different under
       Blog than under Artworks.
       Changed: index.html, js/analytics.js, js/sections.js,
       js/search.js, css/analytics.css, sw.js, and a migration.
   v169 — an artist can see what their work did.
       Profile → Settings → Activity → Analytics: twelve sections over
       artworks only, on a new page that builds itself the first time
       it is opened. Overview, growth, per-artwork performance, content
       insights, audience, traffic, on-site search, engagement, cred,
       community, goals and comparisons. Cred, not followers: nobody
       follows anybody here, profile_creds is what one artist gives
       another, and that is the metric the page charts. No money in it
       either — artworks are not for sale on this site, so an earnings
       tile would read zero for everyone forever.
       Almost all of it comes off tables that already existed, so the
       charts have real history the day they ship: artwork_view_dedup
       is a daily series nobody had drawn, likes and bookmarks carry
       created_at, item_comments carries the comments and friendships
       carries the connections. Four things had never been written
       down anywhere — where a visit came from, what country it was
       from, what device it was on, and what was searched — and one
       thing had no table at all: a share. analytics_events is that
       table, written only by SECURITY DEFINER functions that resolve
       the owner themselves, deduped to one row per viewer per thing
       per day, and readable only by the artist it belongs to.
       register_artwork_view and register_artwork_download gained four
       optional parameters and record the dimension row inside the
       same branch that decides a view happened, so the two counts can
       never disagree.
       Live: the page subscribes to its own rows over realtime — the
       first thing on the site to use it — and polls every 45 seconds
       as well, because a socket can be blocked and a number that is
       quietly stale is worse than one that is slow. A refresh asked
       for while one is in flight is queued rather than dropped, and a
       dropped socket resubscribes.
       Giving cred writes an analytics_events row so the receiver's
       page updates on the spot. It carries no giver: actor_id is
       nulled and the viewer key hashed, because profile_creds has
       always let only the giver read their own rows and a SECURITY
       DEFINER function is exactly the thing that could undo that
       without anyone noticing. The dashboard says "an artist gave you
       cred" and means it.
       Every figure is written out in full. 238,393, never 238K. The
       type scale is seven variables re-set at the same three
       breakpoints css/profile.css uses, so the page reads at the same
       size as the rest of the site on a phone, a tablet and a desktop.
       Six bright chart colours, evenly spaced round the wheel, fixed
       rather than themed — a metric has to be the same colour in dark,
       graydark and light, and the accent token is not.
       Changed: index.html, css/analytics.css (new), js/analytics.js
       (new), js/engagement.js, js/search.js, js/gallery.js,
       js/profile.js, js/sections.js, js/app-core.js, sw.js, and a
       migration.
   v167 — the section header is the section header, and Browse exists.
       Community had its own header — a bordered chip, bordered
       buttons, its own sizes — while every other section shares one.
       It wears .fgTopBar now, literally the gallery's classes rather
       than a copy of them, so the two cannot drift: same mark, same
       type, same borderless controls, this section's green.
       Search was a bar that slid down under the header. It is a page,
       on the same component #fgSearchPage and #pfSearchPage use — back
       arrow, one field, scope chips, results — and it opens on
       Communities or Artists depending on which tab was being read.
       New beside it: Browse, listing every public community biggest
       first. Until now the only way to find one you were not in was to
       be handed its name and join ID by somebody who was. Icon, name,
       description, member count and a Join that asks before it acts.
       cm_browse ranks them, excludes banned rows from the count, and
       lists public communities only — a private one being unlisted is
       most of what private means.
       Gone: links_allowed. enforce_community_links only refused a link
       when the flag was explicitly false, so any community with it null
       allowed every link ever posted. Links are refused everywhere now,
       in the six site rooms too, which the old body returned early for,
       and there is no setting.
       Changed: index.html, css/community.css, css/viewer.css,
       js/community.js, js/mywork.js, js/app-core.js, sw.js, and two
       migrations.
   v165 — Escape stops at the page it was pressed on.
       js/pfedit.js carries one global Escape that closes a dozen
       overlays by name, the community section among them. It already
       stepped aside for the profile search and the guidelines sheet;
       it did not for the community's own page or the friends page, so
       one Escape on either dropped the whole section behind them. The
       friends page has been doing that for as long as it has existed.
       Both are guarded now, and each page stops the event where it
       handles it, so the fix does not depend on which script loaded
       first.
       Swept out with it: .cmCode, orphaned when the manage modal went,
       and .cpHdr, .cpTitle, .cpSubtitle, .cpHdrText, .cpCommentMeta,
       .cpCommentText, .cpPhoto and .dmHint, which had outlived their
       markup some time before this branch and nothing referenced.
       Changed: js/pfedit.js, js/dm.js, js/mywork.js, css/community.css,
       css/viewer.css, css/widgets.css, css/overrides.css,
       css/panels.css, index.html, sw.js.
   v164 — every message goes through one sliding-window gate.
       comments and direct_messages were behind a fixed-window counter:
       20 comments per 5 minutes, which is four a minute — two people
       talking quickly hit it while behaving perfectly normally, and got
       a refusal with no idea when it lifted. A fixed window is also the
       wrong shape: it resets on a clock boundary, so a script sending
       its whole allowance at :59 and again at :01 gets double through in
       two seconds, while somebody who sent nothing for four minutes
       still cannot send at 4:59.
       Five sliding bands now, over an append-only log — 5 in 10s, 30 a
       minute, 150 in ten minutes, 500 an hour, 3000 a day — plus 1000
       characters, a second between messages, and thirty seconds before
       the same text goes twice. The log is its own table rather than a
       count of the message tables, because a member can delete their own
       messages and counting deletable rows means a spammer resets their
       own limit by tidying up.
       Hitting one is a cooldown, not a ban, and it says how long. They
       escalate only on repeats — 10s, 30s, 2m, 10m, an hour — and the
       record clears after an hour of behaving, so an ordinary member who
       trips the burst limit once never sees the second step. Past the
       fifth strike it becomes an hour muted in the room, through the
       timeout_until moderators already use.
       The gate drops the row rather than raising: raising aborted the
       statement and took the cooldown it had just written with it, so
       every strike was the first strike forever. What a caller sees is
       an insert that returns no row; dz_chat_status says why and for how
       long, and says it whether the caller is the site or somebody
       posting to PostgREST by hand.
       The composers check the same five bands before the round trip and
       count the cooldown down on the send button. Name, short
       description, description and rules are CHECK constraints now, not
       just maxlength on an input.
       Changed: index.html, js/community.js, js/dm.js, js/mywork.js,
       sw.js, and a migration.
   v163 — the community icon is stored as webp.
       It was encoded to jpeg. Every other image this site stores is
       webp, and there was no reason a 256px icon should be the one that
       is not. toBlob quietly hands back a PNG when it cannot encode the
       type it was asked for, so the extension is taken from the blob
       that came out rather than the one that went in — a .webp holding
       PNG bytes would be served with the wrong content type.
       The picker's hint line lost a sentence it had no business making
       a promise about.
       Changed: index.html, js/mywork.js, sw.js.
   v162 — the icon is a file, and every action is a box.
       The settings form asked for an "icon image URL", which only works
       for somebody who already has the image hosted somewhere else, and
       whatever they paste can rot, redirect or be swapped out later. It
       is a file picker now, through the same signer profile photos use:
       centre-cropped square, 256px, stored on DigiArtz, committed the
       moment it is chosen. Replacing an icon deletes the file it
       replaced — avatar_storage_path is what makes that possible.
       View profile, Report and Ban were bare rows of text, which read as
       a paragraph you tap somewhere in rather than as separate
       decisions. Each one has its own edge now, in every sheet on the
       page. Change role and Timeout became their own step behind a Back
       — flattened they were eleven boxes, and View profile, which is
       what almost every tap is after, sat above a scroll.
       Checked in all three themes rather than the one it was built in.
       Changed: index.html, css/community.css, js/mywork.js, sw.js, and a
       column on communities.
   v161 — a community becomes a place, not just a room.
       Tapping a community's icon in the chat header opens its own page —
       a page, sliding in over the room, not a box you dismiss by tapping
       beside it. Icon, name, the short line, the description, the rules,
       how many people are in it, and who they are.
       What that page offers is decided once, by rank, and everything
       somebody may not do is absent rather than greyed out. A member
       sees the community, All members, Leave and Report. Whoever runs it
       also sees the Ban list beside All members, the settings — icon,
       name, short description, description, rules, public/private, links
       — and Delete, behind a confirm and then the name typed back.
       Tapping a name in the chat and tapping a row in the member list
       now open the same sheet: avatar, name, @handle, View profile,
       Report, and — only for somebody who holds rank over them —
       promote, timeout, remove and ban. There were two of these before,
       one per place, and only one of them could moderate.
       A message gets a ⋯: copy it, look at who wrote it, report it, and
       delete it if it is yours or you moderate there. comments had no
       delete policy at all, so until now nothing was deletable by
       anyone, author included.
       In 20260812_community_page.sql: short_description and is_public on
       communities, cm_leave (an owner cannot — delete it instead),
       cm_delete (which takes the room's messages with it, since they are
       keyed by a text channel and no foreign key would ever collect
       them), cm_join_public, a delete policy on comments, and
       item_reports widened to carry a community, a member and a message.
       is_public defaults to false, so no existing community changes
       hands the day this lands.
       Retired with it: the manage modal, the member modal and the mini
       profile card, all three replaced by the page and the one sheet.
       Changed: index.html, css/community.css, css/viewer.css,
       js/mywork.js, js/app-core.js, sw.js, and a migration.
   v160 — the community header does the two things the page is for.
       COMMUNITY sat centred in its own bar with nothing beside it, and
       everything the page can do was somewhere down the scroll: the
       people search was a box halfway down, and the friends page — the
       only place a request can be accepted, declined or a friend
       removed — was reachable only from the profile drawer.
       The header carries them now. Section icon and name on the left,
       search and friends on the right, and no avatar: the member's own
       profile is already one tap away in the nav and has no business in
       a section header.
       Community and Friends are two tabs under the banner, and there is
       one search box rather than one per tab — it reads which tab is
       open and searches that. On Community it filters the cards already
       on the page, which it can do because every community is rendered:
       no "view all", nothing held back, nothing to fetch. On Friends it
       runs the username search that used to live in the scroll, through
       dmPeopleSearch. The friends button opens the same #frdPage the
       drawer opens, and wears the number of requests waiting.
       The page is coloured now, and stays coloured: the accent is a fixed
       green rather than the theme's, which went grey in the mono themes and
       took the whole section with it. The banner is drawn in that palette —
       three-colour headline, dashed wire rings, dot grids and scattered
       colour dots, all positioned in percentages and sized in vw, so it is
       one design from a 320px phone to a desktop and has nothing in it with
       an aspect ratio to distort. Two counts sit on it, the member's own:
       communities they are in and friends they have, in boxes that are the
       same size as each other at every width.
       Behind it, in 20260811_community_and_friend_caps.sql: 50
       communities and 200 friends per member, 100 outgoing requests
       waiting, and the write rate limiter — which went table by table
       through everything typed and never reached these three, because a
       membership is not text — now covers friendships, communities and
       community_members. One created community per artist was already
       real in cm_create and is unchanged. The js checks the same
       numbers so a member is told before the round trip, but the
       triggers are what enforce them.
       Changed: index.html, css/viewer.css, css/community.css,
       js/community.js, js/dm.js, js/mywork.js, sw.js, and a migration.
   v155 — every viewer opens the same way, and closes.
       The five detail views had no way out. Closing one meant the
       browser's own back button, and since every Next pushed a history
       entry, ten artworks into a gallery was ten presses to get out of
       it. Both halves of that are fixed: Next and Previous replace the
       entry rather than stacking one, so a run of any length is one
       press — and there is a red ✕ at the top of all five now, in a card
       that is the same card everywhere.
       The card: avatar, display name, @handle, the way out, and the
       profile page's own two buttons — literally .pfActBtn, so Add
       friend and Cred are the same size and the same colour here as
       there, and split the row evenly. Both act on the artist whose work
       is open. Your own work shows neither.
       Under it, a rail of five round buttons, each in its own colour:
       like, bookmark, download-or-cart, share, report. Centred where
       there is room, spread edge to edge on a phone. Jobs has no rail —
       a posting is not liked, saved or bought — and keeps the report
       button at the foot of the ad.
       Everything that used to sit at the bottom of a view is in that
       rail now, so the foot of all five is the comment block and
       nothing else. On a resource the file row carries its own download
       beside the rail's: the rail takes the package, the row takes the
       file.
       Comments: the box you type in is above what everyone else typed,
       the newest is directly under it, and they arrive twenty at a time
       on a button rather than two hundred at once. Deleting one asks
       first — Cancel or Delete, in the site's own voice rather than the
       browser's.
       Three tables behind it, in 20260810_item_engagement_and_cart.sql:
       item_likes and item_bookmarks give resources, posts and listings
       the two answers artworks have always had, and cart_items is the
       store behind the Cart tab, which has been a tab with filters and
       nothing behind it since the gallery grew six of them. Cart is a
       panel now, and Add to cart fills it.
       A post, a resource, a listing and a posting each have a link of
       their own — /blog/<id>, /resource/<id>, /listing/<id>,
       /job/<id> — because Share needs something to share and until now
       only an artwork had one. The view writes it while it is open and
       opens from it on a cold load.
       One pair of tokens sets the padding and the gap for all five, so
       every viewer has the same space left, right and between at every
       width, one step down on a phone and one step up on a wide screen.
       Changed: js/sections.js, js/gallery.js, js/startup.js, index.html,
       css/viewer.css, css/overrides.css, _redirects, sw.js, and a
       migration.
   v154 — two ways to apply are two ways to apply.
       A posting and a commission listing each take an apply link and an
       apply email, and the detail views took the link when both were
       there and dropped the address. That closes a door the employer or
       the seller had deliberately opened — someone who offered both
       offered both. Both are drawn now, as their own buttons: Apply and
       Apply by email on a posting, Request this and Request by email on
       a listing. Either alone is unchanged.
       On the form the pair is a pair, and never said so. Neither box
       carried the required mark, so nothing on the form asked for what
       publish then refused to go without. Both carry it now while both
       are empty, and it comes off both the moment either is filled —
       which is the rule: one of the two, and filling one is what makes
       the other optional. Clearing it again brings the mark back. The
       hint on both boxes says it in words as well. reqOne is the field
       spec for this; publish still checks the pair itself, since a form
       is a courtesy and a constraint is a guarantee.
       Changed: js/sections.js, index.html, sw.js.
   v153 — every detail view reads in the order someone reads it.
       The five upload forms grew most of a page of new fields each and
       every one of them reaches its detail view, but they arrived in the
       order they were added rather than the order anyone reads. Five
       views, re-laid-out; no field gained or lost, and nothing new is
       asked for.
       Artwork: the details panel sat between the summary and the
       description, so the piece's specification interrupted the artist's
       own words. Description first now, then process notes and credits,
       then the panel — headed Details, which it never was — then the
       links and the tags. Resolution moved up beside Software, since it
       was splitting the two technical rows around the three legal ones.
       A featured artwork says so, the way the other four sections have
       always said it on theirs.
       Resources: the file card sat above the title and the download
       button below the comments, so the two halves of the one thing
       every visitor came for were a page apart. Title, summary, author,
       file card, download — then the reading.
       Marketplace: the extra shots sat below the summary rather than
       under the image they extend; the locked-files note and the
       commission request sat past the tags, away from the price they
       explain. All of the buying decision is one run at the top now, and
       the twenty-row panel is two: what it is, and what happens after
       the money.
       Blog: the byline sat under the type-and-read-time panel, which put
       the filing details ahead of the person who wrote the post.
       Jobs: sixteen rows of specification stood between the headline and
       the first sentence of the ad. Eight of them are the facts an
       applicant decides on and stay at the top, with the Apply button
       under them; the other eight are how the week works and sit below
       the ad as Role details. Apply is also drawn once more under the
       application instructions, for the reader who read to the end.
       Two helpers came out of it: metaBlock, which is the meta panel
       with a heading, and linkBlock, which the resource links and the
       post's sources were each writing out for themselves.
       Changed: js/sections.js, js/gallery.js, index.html, sw.js.
   v152 — the gallery's rail is the rail, and a dropzone badge means one
       thing.
       The last three the v151 audit left open, all of which needed a
       decision rather than work. The decision: the gallery is canonical.
       It is where a member meets these five sections first and most
       often, so the upload sheet follows it rather than the other way
       round.
       Order was Artwork, Resources, Blog, Marketplace, Jobs against the
       gallery's Artworks, Market, Blog, Resources, Jobs — Resources and
       Marketplace swapped, so the two rails read differently on the same
       five things. The sheet takes the gallery's order. Cart has nothing
       to post to, so the sheet still has five tabs to the gallery's six.
       Names follow too: Artworks and Market, not Artwork and
       Marketplace. The guide sheet's kicker reads off the same table, so
       it says ARTWORKS now without being told separately.
       Dropzone badges followed two rules — the artwork zone drew the
       upload mark, the other three drew their section's glyph. A badge
       there answers "what does this box do", not "which section am I
       in": the highlighted tab already answers that, and the title under
       the badge already says what goes in. All eight zones draw the
       upload mark now. That supersedes v151's stack of frames on the Add
       more images zone — telling the extras zone from the cover zone was
       a second rule nobody asked for, and the titles under them were
       already doing that work.
       secIco is zoneIco: it never depended on the section again, and a
       name that says otherwise is how the two rules got there.
       Changed: js/sections.js, index.html, sw.js.
   v151 — four things an audit of the upload sheet turned up.
       Sweeping the whole sheet — five forms against each other and
       against the gallery — found seven mismatches. Three of them are
       decisions rather than defects and are left alone for now: the two
       rails order and name their tabs differently, and the dropzone
       badges follow two different rules about what a badge means. These
       four had no such question hanging over them.
       The artwork panel never said uploads are reviewed. All four
       section forms have carried that line since they were built, and
       this is the one form that actually stops on it — every artwork goes
       through /api/moderate-upload on the way out. So the member most
       likely to meet a refusal was the only one not warned it was coming.
       It says so now, before the wait rather than after.
       The section forms' Publish was the one button of the ten on the
       sheet with no mark on it — Save Draft beside it has had its 💾 all
       along, and the artwork panel's primary its 📤. It takes the 📤 too.
       The restore in dzSubmit's finally block was writing the bare word
       back, so the first failed publish would have stripped it off again;
       that writes the full label now.
       The Add more images dropzone led with a text emoji while every
       other dropzone on the sheet led with a drawn glyph in a tinted
       tile, and it sits directly under the cover dropzone. It is a stack
       of frames now, drawn — deliberately not the cover zone's tray and
       arrow, since that zone takes the one image that matters and this
       one takes the extras. openPfUpload was overwriting the badge with
       textContent, which would have deleted the svg, so it no longer
       writes it; only the words that panel changes are written.
       FIELD_ICO had two keys declared twice, body and
       modification_allowed. Both pairs held the same value, so nothing
       rendered wrong and the later one silently won — removed before the
       values drift apart and the duplicate starts mattering.
       Changed: js/sections.js, js/albums.js, css/upload.css, index.html,
       sw.js.
   v150 — every section is the gallery's own colour, in every theme.
       v149 moved Jobs from pink to cyan and called the two rails settled.
       They were not. Checking the actual hex rather than the colour's
       name found Jobs still off in the dark themes — the sheet's cyan is
       #22D3EE, the rail's is #38BDF8 — and two more that v149 had not
       looked at: Blog was blue against the rail's indigo, Marketplace
       amber against its orange, and those two disagreed under every
       theme, not just the dark ones. Artwork and Resources were exact all
       along, which is what made the other three read as drift rather than
       as a second palette.
       All five now carry the rail's own values. Marketplace needed no new
       colour at all: the rail's orange is --upcOrange, already in the
       palette and simply not the one Marketplace was pointing at. Jobs
       and Blog needed names the palette did not have, so --upcSky and
       --upcIndigo were added, read off #fgSecTabs.
       Not --upcCyan for Jobs, though it is the nearer name. A dozen field
       icons draw from it — tags, slug, the seo pair, four of the job
       form's own rows — so bending it to the rail's sky would have
       recoloured all of them on all five forms to settle one chip.
       All three themes, not two. The sheet splits its palette :root /
       html[data-theme="light"], and graydark is a dark ground that takes
       the :root step — which is the same split .fgSecBtn uses for these
       very colours, so the two rails now agree by construction rather
       than by coincidence. Measured all fifteen: five sections across
       dark, graydark and light, every one an exact match.
       Changed: js/sections.js, css/upload.css, index.html, sw.js.
   v149 — Jobs is cyan on both rails.
       v148 gave the upload sheet the gallery's five section icons and
       left the five section colours alone, which closed the icon question
       and left one colour question open: Jobs was pink on the upload
       sheet and cyan in the gallery, the only section where the two rails
       still disagreed. It is cyan on both now.
       --upcCyan rather than a fresh hex — it is already in the sheet's
       palette, so the colour keeps the light/dark pair every other
       section colour has instead of being one hex that has to work on
       both. Measured: on the light theme it lands on #0891B2, which is
       the gallery rail's light cyan exactly; on the dark theme it is
       #22D3EE against the rail's #38BDF8 — neighbours rather than the
       same swatch, since the two palettes were picked separately. Close
       enough that the rails read as one, and not worth a hardcoded hex
       outside the palette to close the last step.
       The colour reaches two things: the Jobs tab chip and the Jobs
       guidelines sheet. It does not reach the form's field icons — those
       are coloured per field by what the field is, not by which section
       it sits on — so nothing inside the jobs form moves.
       Changed: js/sections.js, index.html, sw.js.
   v148 — a section wears one icon, and the upload mark is an upload mark.
       The gallery's tab rail and the upload sheet's tab rail name the same
       five sections and drew three of them as different objects.
       Marketplace was a storefront to browse and a shopping bag to post
       to; Blog was a page of text and a pencil; Resources was a stack of
       layers and an open book. Artworks and Jobs already agreed, which is
       what made the other three read as a mistake rather than a style.
       The upload sheet takes the gallery's path data for all five now,
       copied rather than redrawn, so the two rails cannot drift again
       without somebody editing both. The same glyphs lead each section's
       empty dropzone, so what a member taps in the rail is what greets
       them inside it.
       The sheet's own mark was a cloud with an arrow through it. A cloud
       says the file goes somewhere else; the tray-and-arrow is what the
       rest of the web means by upload, and it is what the sheet was asked
       for. Indigo rather than violet, matching it.
       The artwork dropzone's badge was the other cloud, and it sat two
       lines above a Select image button already drawing the tray and
       arrow for the same action. It carries that glyph now too, so the
       header mark, the dropzone badge and the button are one symbol
       rather than three-quarters of one.
       The five section colours are unchanged, so the tinting the forms,
       chips and guide sheets share still holds. Jobs is the one place the
       two rails still disagree — pink on the upload sheet, cyan in the
       gallery — and that is a colour question, not an icon one.
       Changed: js/sections.js, index.html, sw.js.
   v147 — Software Used is a list you can pick from again.
       The artwork panel had a Software Used dropdown, ten entries, one
       choice. v139 replaced it with a list — up to ten, so a piece made
       in three programs can say so — and stood the old control down. But
       the list shipped as a bare box with "Photoshop, then press Enter"
       in it and nothing to open, sitting between Artwork type and Add to
       Album, which both open menus. So the row read as a dropdown that
       had stopped working, and answering it meant spelling "Clip Studio
       Paint" from memory. The uploader who reported it read the field as
       broken rather than as changed, which is fair: nothing on it said
       there was anything to press.
       A chip list can carry its own menu now, and Software Used carries
       one — the ten it used to offer plus thirteen more. Ticking adds,
       unticking removes, the box below still takes anything the list does
       not name, and the ten-entry ceiling holds whichever half is used.
       The hidden input stays the single answer to what is in the list, so
       the ticks, the chips and the trigger are redrawn from it together
       and a restored draft comes back with all three agreeing.
       Resources' Compatible software is the same field with the same
       list, so it gets the same menu.
       Also: the tag box's example reads "character, birds, nature, etc."
       on all five forms now, instead of naming one fandom.
       Changed: js/sections.js, js/albums.js, css/upload.css, index.html,
       sw.js.
   v146 — a tag box takes a list.
       "anime, chr, genshin impact" is three tags. It was one, with the
       commas inside it, in every case except typing the commas slowly
       enough for each keystroke to be caught on its own — so pasting a
       list made one tag, and so did typing the lot and pressing Enter.
       Commas and newlines split now, wherever the text came from. And
       finishing counts three ways rather than one: Enter, a typed comma,
       or simply tapping something else on the form. That last one was
       losing a tag outright — typing one and going straight to Publish
       left it sitting in the box, which reads as the box not working.
       A pasted list commits; a pasted word does not, because that is
       somebody starting to type rather than finishing.
       The box's own ceiling was the per-tag ceiling, twenty or thirty
       characters, so a run of three tags did not fit in it at all. The
       box holds a run now and the per-tag limit is applied to each tag as
       it is committed — over-long is trimmed to thirty and says so,
       rather than the whole entry being refused.
       Two smaller faults with it: the artwork panel capped a tag at
       fifteen characters while its own input, the other four forms and
       the artworks table all allow thirty, so a legal twenty character
       tag was refused by the one form that has always had tags; and a
       leading # is dropped on every form now rather than only some.
       Empty entries between stray commas are ignored, the same tag typed
       three ways is one tag, and the ten tag limit still holds.
       Changed: js/sections.js, js/albums.js, index.html, sw.js.
   v145 — no listing states a licence its owner was never asked about.
       Checking the jobs and resource views for gaps found jobs complete
       and resources complete, and turned up the same fault in resources
       and the marketplace that v143 had already fixed for artworks.
       Both views printed a Rights line built straight from three boolean
       columns. Every row written before those questions existed carries
       their defaults, not an answer — so a resource shared last year read
       "Personal use only · Modification allowed", and a marketplace
       listing read "Commercial use allowed", because that column defaults
       to true. The second is the one that matters: it granted a licence
       the seller never granted, on a page where somebody decides whether
       to pay. Neither line is drawn now unless the row carries the field
       that only the current form writes — resource_type and product_type
       — so an older row states nothing on its owner's behalf.
       Jobs was already clean, and for a reason worth keeping: its three
       application booleans are rendered by listing only the ones that are
       true and dropping the block when none are, which cannot invent a
       claim whatever the defaults are.
       Also gave jobs, resources and the marketplace the Updated row they
       stored and never showed, sharing the rule the blog view already
       used — it appears once it says something the posting date does not.
       Changed: js/sections.js, index.html, sw.js.
   v144 — the category and the tags reach the detail views too.
       Checking the marketplace and blog views for gaps after v143 found
       the same two in all four sections, and one of them was a mislabel
       rather than an omission.
       The marketplace and resource views had a row headed "Category" that
       was printing the SUBcategory, so a listing filed under Brushes and
       sub-filed under Inking read as "Category: Inking" and the real
       category appeared nowhere. Both rows are there now under their own
       names. Jobs and blog never had a category row at all and have one.
       And not one of the four ever showed its tags — the words the member
       chose, and the thing their section is searched by. Every detail
       view ends with them now, drawn the way the artwork viewer has drawn
       its own all along.
       A category is stored as the slug the picker wrote, so it is read
       back through the same map the cards use rather than printed as a
       slug; anything that map does not recognise is printed as it stands
       rather than dropped.
       Changed: js/sections.js, index.html, sw.js.
   v143 — what an artist fills in about an artwork now reaches the viewer.
       The other four sections read their new fields back in v135 to v138;
       the artwork viewer never did, so a member could answer eighteen
       questions about a piece and see none of the answers anywhere. It
       was the one place the work went in and did not come out.
       The summary leads under the title. The meta list carries the
       artist's own medium rather than a hard-coded "Digital Art", the
       subject, the whole software list instead of the one name it used
       to hold, the licence, what a viewer may do with it, and an 18+ mark
       where the piece is mature. Process notes, credits and links follow
       the tags, each with its own divider and each dropped when empty.
       An artist who turned comments off gets no comment box, and the
       panel says so — what was already said stays readable, because
       turning comments off ends a conversation rather than erasing it.
       The one thing worth being careful about: every artwork uploaded
       before these columns existed has commercial_use, attribution and
       modification sitting at false because that is the column default,
       not because anyone said so. Reading those back would print
       "Personal use only" under work whose artist never chose it. The
       presence of a licence is what marks the answers as the artist's,
       so a piece from before simply shows no rights at all — measured,
       along with the medium falling back to its old label and every new
       block staying absent.
       Links are the artist's own text, so anything that is not http is
       printed rather than made followable, and the rest carry noopener.
       Changed: js/gallery.js, css/viewer.css, index.html, sw.js.
   v142 — Automatic Details fills itself in as you type.
       The card listed what the system would work out and described how,
       which told a member the mechanism and never the answer. It shows
       the answer now, and shows it while the form is being filled in.
       A value reads -- until there is something to derive it from. The
       file format, the size and the dimensions arrive the moment an image
       is chosen; the SEO title and the slug follow the Title keystroke by
       keystroke; the SEO description follows the Description, and drops
       back to -- when what is typed falls under the floor the column
       asks for, because that is exactly when nothing would be stored.
       The rows that could never be live are gone rather than sitting at
       -- forever: the created and updated dates, the view, like and
       bookmark counts, the author, and the resource download count. What
       is left is only what the form can answer. Each pair is separated by
       a rule, and the figures are tabular so one that changes as you type
       does not shift the ones under it.
       Nothing is written anywhere. Every value here is computed in the
       browser and the publish path still produces the stored values
       exactly as it did — the card having run or not cannot change what
       lands in the row. What is read out of a file is read once per file
       rather than once per keystroke, which matters because measuring an
       image or walking a zip's directory is far too expensive to repeat
       while somebody types a title: measured, a hundred keystrokes read
       the file zero times, and a new file reads exactly once.
       Blog and Resources have the same card and the same treatment —
       blog's slug and reading time follow the title and the body, and a
       resource's format, size, file count and resolution arrive with the
       upload.
       Changed: js/sections.js, js/albums.js, js/drafts.js,
       css/upload.css, index.html, sw.js.
   v141 — the artwork panel's new rows sit and behave like every other
       upload form's.
       Two things were wrong with the way v139 fitted eighteen fields into
       hand-written markup, and both were about the five slots they were
       fitted into rather than about the fields.
       The rows were touching. Those slots are direct children of
       .upFieldsCol, the flex column that spaces every row on the form
       apart — so a slot holding nine rows counted as one row, took one
       gap, and left the nine inside it with none. The panel's own rows
       kept their spacing, which is why only the new ones looked wrong.
       display:contents takes the wrapper out of layout entirely: the rows
       inside a slot become direct participants of the same column and are
       spaced by the same gap as everything else, and an empty slot now
       takes up nothing rather than eating a gap.
       Four menus could be open at once. Every dropdown on either form
       carries .upCatDd, but closing them was scoped to #upSecForms, so on
       the artwork panel nothing closed anything — and the panel's own
       category, album and schedule pickers, written long before any of
       this, did not know the new ones existed either. One exported
       function closes them all now, and both sides call it, so the rule
       holds in both directions rather than in neither.
       Changed: css/upload.css, js/sections.js, js/albums.js, js/drafts.js,
       index.html, sw.js.
   v140 — every text write is rate limited, and the artwork edit form
       stops overwriting what it never read.
       An audit of the write paths after the five composer revamps. The
       site already rate limited the two things that cost money — uploads,
       in the storage signer, and payments, in the payment endpoints — and
       nothing else. A job posting and a blog post need no file at all, so
       nothing whatsoever stood between one script and a table full of
       them; comments, reports and direct messages were the same.
       Twenty-one triggers now, on every table a member can write words
       into, calling the rate counter that already existed for the download
       and view tallies. Measured: the sixteenth job posting in an hour is
       refused with a message a member can read, and the fifteen before it
       are not. The bucket is per member, per table and per operation, so
       commenting fast cannot exhaust the ability to publish and one member
       can never exhaust another's. auth.uid() is null for the two
       scheduled publishers, so a queue of forty scheduled posts still
       publishes — they were rate limited when they were queued, which is
       the moment that belonged to the member.
       Two bugs found and fixed while looking:
       artworks gained an updated_at column in v139 and nothing maintained
       it, so "Last updated" would have read as the upload time forever.
       The other four content tables have carried that trigger for a
       while; artworks never had the column to need one.
       The artwork edit form did not prefill any of the fields v139 added,
       so opening a piece to fix a typo and saving would have written the
       form's defaults — All rights reserved, published, no credits, no
       links — over whatever the uploader actually chose. It starts from
       the stored piece now. Maturity is the one thing an edit may raise
       but not lower: an uploader can mark their own work mature, and
       cannot untick a piece moderation judged so.
       Also stood down the old one-of-ten software picker on the edit path,
       which was being shown again beside the list that replaced it.
       Changed: js/sections.js, js/drafts.js, js/mywork.js, index.html,
       sw.js, supabase/migrations/20260809_write_rate_limits.sql.
   v139 — an artwork says what it is, and what may be done with it.
       The fifth and last, and the awkward one. The other four forms are
       drawn by buildForm from a list of field descriptors; the artwork
       panel is hand-written markup in index.html that predates all of it.
       Rather than hand-write eighteen more cards into that markup — and
       with them a second copy of the counters, the conditional rows and
       the chip lists — five empty divs are cut into it and filled from a
       descriptor list like everyone else's. That is what lets the whole
       panel read in its specified order without being rebuilt: a summary
       between the title and the description, the medium between the
       category and the tags, the licence questions between the album
       picker and the schedule.
       Software is conditional in the sense the spec means, which is not
       the sense the other forms use it in: the field is always on the
       form, and what changes is whether publish will let it stay empty.
       A digital painting must name what it was made in; a watercolour has
       no software to name. That needed a required-when rather than a
       shown-when, so reqIf exists now beside cond.
       Two columns that already existed are kept rather than replaced.
       software is a single name half the site reads, so software_list is
       the real answer and software is kept in step with its first entry —
       nothing that reads the old column has to learn anything. is_mature
       was set by moderation from the AI rating; it now has two sources and
       they are OR-ed, because an uploader calling their work mature is
       something moderation does not know, and moderation calling it mature
       is something the uploader did not volunteer.
       The derived half is derived: format and size off the file,
       dimensions off the image, the SEO pair and the slug off what was
       typed. Not one of them has a box.
       The scheduled path carries all of it. A scheduled upload waits in
       scheduled_uploads and the publisher builds the row from it, so every
       new field would have been dropped in transit; one jsonb column
       carries them and the publisher unpacks it. Measured end to end: a
       scheduled upload publishes with its software list, credits, links,
       slug, dimensions and its declared maturity intact.
       Ceilings: 20MB an image, ten extra images, ten albums, ten software
       entries, twenty credits, five links — each refused at the point of
       adding, and each repeated as a constraint. Measured, the table
       rejects a 60k description, a 900MB file size, forty software
       entries, twenty links, a 900-character credit, forty tags, a bogus
       visibility, a description under its floor, 9999999px dimensions and
       thirty extra images.
       The gallery shows published work only, and a profile gallery shows a
       visitor the same — while still showing you your own drafts.
       All five composers share one system as of this version.
       Changed: js/sections.js, js/drafts.js, js/albums.js, js/upqueue.js,
       js/mywork.js, js/app-core.js, index.html, sw.js,
       supabase/migrations/20260809_artworks_full_upload.sql.
   v138 — a resource says what is in the package, and reads the rest off
       the upload.
       The last of the four. The composer asked for a file, a preview, a
       title, a description, a category and a license; what kind of asset
       it is, what software opens it, what is actually inside the zip,
       whether it may be sold on, and how to install it were all left to
       one description box.
       The same line as the blog form, drawn where it belongs here: file
       format, file size, how many files are inside the package, the
       preview's resolution, the author, the dates and the download count
       are all worked out, and none of them has a box to type wrong.
       Two of those are new and are read rather than guessed. The file
       count walks the zip's own central directory — the record at the tail
       says where the directory is and how many entries it holds, and the
       entries say which are folders — so a 200MB package costs a few
       kilobytes to count, folders are not counted as files, and anything
       that is not a plain zip gets no answer rather than a wrong one.
       Measured on a real archive of three files in two folders: three.
       The resolution is the preview's own pixels, with a timeout so a
       stubborn image can never hold up a publish.
       The three licence questions are required answers rather than
       unticked boxes, because an unticked box and an unanswered question
       look identical and these decide whether someone may sell the work
       they make with the file.
       The chip list the blog form grew for its sources is general now: it
       takes plain entries as well as links, with its own per-entry bounds
       and its own ceiling. Compatible software uses it at ten entries and
       does not have a scheme forced onto it; external links use it at five
       and do.
       Floors and ceilings repeated as constraints as in v135–v137:
       measured, the table rejects a 60k description, a 900MB file size,
       forty compatible-software entries, twenty links, a 9k what's-
       included, a bogus visibility, a description under its floor and a
       9999999 file count.
       Search applies visibility for resources now, completing the set.
       All four composers share one system as of this version.
       Changed: js/sections.js, js/search.js, index.html, sw.js,
       supabase/migrations/20260809_resources_full_listing.sql.
   v137 — a post carries its own context, and stops asking for what it
       already knows.
       The third of these, and the one with a line running through it. The
       composer asked for a title, an excerpt, a body, a category and tags;
       what kind of piece it is, what work it is about, where its claims
       came from and whether it is even meant to be public yet were all
       unaskable.
       The line is which fields a person fills in and which the system
       does. Slug, author, author bio, reading time, publication date, last
       updated and the three counters are never asked for — there is no box
       to type them wrong in. A reading time somebody enters is wrong the
       moment they edit a paragraph, a slug that drifts from the title is a
       link that lies, and an author somebody types is a byline they may not
       be entitled to. They are derived at publish and shown back by a
       read-only card at the end of the form, so nobody wonders where they
       went. The SEO pair sits on the other side of that line: editable,
       and generated from the title and the excerpt when left empty — and
       left null rather than stored short when the generated one cannot
       reach its floor, because a null SEO title is a search engine falling
       back to the real one, which was the better answer anyway.
       Two controls that are new here. A picker that links up to ten of
       your own artworks or listings — your own, which is not a display
       choice: a picker offering everyone's work would let a post attach
       itself to a stranger's artwork. And a list of up to twenty source
       links, each typed and entered, each gaining its scheme if it was
       typed without one. Both keep their value on a hidden input, which is
       what makes them indistinguishable from a text box to every draft and
       publish path that already existed.
       Visibility and the Schedule picker are two halves of one answer, so
       they are reconciled before anything uploads: Scheduled without a time
       is refused, and a Draft with a time is refused, rather than either
       being quietly ignored.
       A post renders its sources as a list. Links that are not http are
       printed rather than linked, and the ones that are carry noopener and
       nofollow — a post is not a licence to script the reader's tab.
       Floors and ceilings as in v135 and v136, repeated as constraints:
       measured, the table rejects a 60k body, fifty references, a 900
       character reference, forty tags, a 200 character tag, thirty related
       artworks, a bogus visibility, a body under its floor, and a
       999999-minute reading time.
       Search applies visibility for blog and marketplace now, the way it
       already did for jobs.
       Changed: js/sections.js, js/search.js, css/overrides.css, index.html,
       sw.js, supabase/migrations/20260809_blog_full_post.sql.
   v136 — a listing says what the buyer is actually buying.
       Same treatment as the job form in v135, applied to the marketplace.
       The composer asked for a title, one description box, a price and a
       license; what is in the download, what format it is in, whether the
       buyer may earn from it, how long delivery takes and whether there is
       a refund were all left to the description or to the comments.
       Forty-seven fields now, in the order a buyer decides: what it is,
       what it looks like, what is in it, what they may do with it, what it
       costs, how it arrives, then the seller's own bookkeeping. Floors and
       ceilings work exactly as they do on the job form, and are repeated as
       table constraints — measured, the table rejects a 200k-character
       description, forty tags, a thirty-image gallery, a "sale" price above
       the price and a description under its floor.
       A listing can carry a gallery now: up to eight more preview shots
       beside the main one, shown as a strip that wraps. They go to the
       public bucket like the preview does, because they are meant to be
       looked at — unlike the files being sold, which keep going somewhere
       a stranger cannot follow.
       Two limits the browser cannot be trusted with. Fifty files per
       listing, enforced by a trigger, because a CHECK cannot count rows in
       another table and nothing capped this before; and eight gallery
       images, enforced by a check on the column. The signer already capped
       each file at 200MB, restricted the types and rate limited the
       uploads, so what was missing was how many.
       Listing type decides the shape of the form. A digital download is
       asked for files and never for a delivery time; a commission or a
       service is asked for a delivery time and a way to be reached, and is
       never asked for files — nor are files picked before the switch
       uploaded, since the listing is no longer selling them.
       Two columns are readable by fewer people than the rest, and the
       grants say so rather than the queries. sale_price_cents goes exactly
       where price_cents goes — signed in only. internal_notes is granted
       for writing and to nobody for reading: row policies cannot help
       there, because any signed-in caller can already read every approved
       listing, so a read grant would hand them everyone's private notes.
       Moderation reads it through the service role.
       The sale price is stored and deliberately not displayed. Checkout
       charges price_cents and lives in the payments module, so a sale price
       shown here would be a number the buyer is quoted and then not
       charged. The field says so.
       Visibility decides whether a listing is listed at all, and featured
       listings sort first. Listings written before any of this still
       render: every new block is dropped when empty.
       Changed: js/sections.js, css/overrides.css, index.html, sw.js,
       supabase/migrations/20260809_marketplace_full_listing.sql.
   v135 — a job posting says the whole job.
       The form asked for a title, a company, one description box and a pay
       range. Everything an applicant actually decides on — the hours, the
       timezone, what to send, when it closes, whether there is one opening
       or five — was either buried inside that one box or simply not asked
       for, so the reader had to guess and the poster had to write an essay.
       Forty fields now, in the order a job ad reads: who is hiring, what the
       role is, where and when it happens, what it pays, how to apply.
       Every text field carries a floor and a ceiling. The ceiling is the
       element's own maxlength, which means the keystroke past it never
       lands — there is nothing to warn about because the text does not
       enter. Numbers work the same way by hand, since a number input hands
       back an empty string for anything it dislikes and so cannot say what
       was typed: the digit that would take the figure past its ceiling is
       dropped as it is typed, so 10000000 openings is 100 and 999 years of
       experience is 9. The floor cannot be enforced that way, because a
       field is under it the whole time it is being filled in, so it is
       shown instead — a count on the label line, opposite the label, in the
       page's own muted ink, going to the same red the required asterisk
       wears while the field is short. Publish refuses while any of them is,
       and takes you to the field rather than naming a number.
       Both bounds are repeated as table constraints, because a form is a
       courtesy and a constraint is a guarantee: measured, the table rejects
       a 200k-character company blurb, 9999 years of experience, a thousand
       eligible countries and negative pay on its own, with no browser
       involved.
       Three questions decide which others get asked. A remote posting is
       never asked for a city and a hybrid one never for a list of eligible
       countries; a permanent role is never asked how long the contract
       runs. A row that is not on the form is not required and is not read
       when publishing, so an answer left behind by an earlier choice cannot
       leak into the posting.
       work_mode replaces the "100% remote" checkbox, which could not say
       hybrid. is_remote stays and stays authoritative — the two location
       constraints, the cards and the search index are all written against
       it — and is kept in step. Postings written before any of this still
       render: every new block is dropped when empty, which for them is all
       of them.
       The detail view lays the posting out instead of printing one box, and
       says who posted it, which it never did. Visibility decides whether a
       posting is listed at all, and featured ones sort first.
       Search applies visibility too, since searching is exactly how an
       unlisted posting would otherwise be found.
       Changed: js/sections.js, js/search.js, css/upload.css, index.html,
       sw.js, supabase/migrations/20260809_jobs_full_posting.sql.
   v134 — the showcase shows the artwork, and the part of it the uploader
       picked.
       The scrim was sized by eye and it buried the picture. Two
       measurements replace the guess. How much ink white type needs over a
       white artwork: about 55% to hold 4.5:1, a floor nothing moves. And
       how far the words actually reach, read off the rendered text rather
       than assumed from the box — on a desktop card only about a third of
       the way across, because the column is capped in ch while the card
       keeps growing. So the ramp holds above the floor out to there and is
       at nothing well before halfway, and the card is measured again to
       say what that bought: 53% of a desktop card is now completely
       untouched artwork, against none of it before, and the ink averaged
       over the whole card falls from 60% to 31%. A phone cannot have this
       and does not get it — one card across a 360px screen puts the
       description within a few percent of the far edge — but it comes down
       to the floor too, 71% to 68%.
       The crop was the other half. thumb_x/thumb_y are stored as an
       object-position, which is an anchor and not a centre: it lines the
       point x% across the image up with the point x% across the box. That
       is right while the box has the shape of the crop stage, which is
       square and which every grid cell on this site matches. This card is
       2:1, so it shows a band, and anchoring slides that band away from the
       middle of the chosen square in proportion to how much shorter it is
       — measured at up to 150px out on a portrait upload, always in the
       direction of the middle of the file. Someone who cropped to the top
       of their picture was shown something closer to the centre of it,
       which is the one thing choosing a crop is meant to prevent. The
       square is reconstructed now — side min(w,h)/zoom, placed by the
       stored anchor — and the card centred on its centre, clamped to the
       edges. Measured across five crops from 0% to 100% including a zoomed
       one: every card lands dead on the centre of what was chosen. It only
       ever agreed at 50%, which is why it read as "always the middle".
       Changed: index.html, css/hero.css, js/fgshow.js, sw.js.
   v133 — the showcase rail answers straight away, moves one card at a
       time, and stops hiding the artwork.
       Three faults, all reported from using it.
       A dot press did nothing for half a second and then arrived in
       steps. Two causes. The dot it lit was read back off the rail's
       position, so it could not change until the rail had travelled far
       enough to round to the next page; it is set from the press now, at
       nought pixels of movement, because the reader pressed it and the
       answer to that is theirs immediately. And the glide ran with the
       mandatory snap still on, which pulls the rail to the nearest card
       over and over while the scroll is in flight — every way of moving
       the rail now goes through one glide that switches the snap off for
       the length of it and back on once the rail is standing on a card
       boundary, where switching it on moves nothing.
       One turn of a wheel moved three or four cards. A wheel does not
       report a turn, it reports a stream: a mouse sends several deltas
       per notch and a trackpad dozens per flick, and each was being
       answered with a card. The stream is one gesture until it goes
       quiet, and a gesture is worth one card however many events it was
       made of.
       And the artwork was being buried by its own scrim — 93% ink over
       the words falling to 80% at the far edge of a phone card, which is
       a black box with a hint of a picture behind it. White type needs
       about 55% ink over a white artwork to hold 4.5:1, so the ramp sits
       a margin above that where words go and falls to NOTHING where they
       do not: the right third of a wide card carries no text, and the
       artwork there is now the artwork rather than a darkened copy of it.
       What was given up instead was the dimming of the type — the
       description was at 76% white and the stat labels at 60%, and those
       were a choice, not a requirement. They come up to 94% and 86% with
       a shadow of their own, and the kind chip's glass is mixed dark
       rather than light so it stops being a pale chip carrying pale type.
       294 contrast measurements again, off the rendered pixels over a
       deliberately near-white artwork, none below 4.5:1.
   v132 — a featured showcase over the gallery's chip row.
       Six cards, paired off across the three boards the site already
       scores: two for daily, two for weekly, two for monthly. Every card
       is an artwork and every card says the same six things about it —
       the picture, the title, who made it, a line or two of description,
       its likes and its views, and a button that opens it. Only the chip
       differs, and it names which of the pair's two slots this one took:
       Artist Spotlight, or Artwork of the Day / Week / Month.
       Nothing new is fetched. The boards are reorderings of the artworks
       already loaded, so the picks are computed locally; the one request
       the section can make is for the profiles behind the bylines, and it
       goes through the same cache the hover chips fill, so opening the
       gallery after reading the home page usually costs nothing at all.
       The leader slot is that board's first place plainly. The spotlight
       beside it is the best-placed piece by somebody else — otherwise a
       pair would be one person printed twice, side by side. Picks are
       kept apart down the column too, so a quiet week cannot fill all six
       cards with the same upload; a site with too little to say gets a
       shorter row instead of a padded one.
       One row at every width — one card on a phone, two on a desktop,
       three past 1600px — and it is slid rather than stepped through
       buttons. There are no arrows on it. A wheel turns it a card at a
       time, a mouse can take hold of it and pull, a finger swipes it, the
       dots jump a page, and the arrow keys walk it once it has focus.
       For as long as a gesture is running the snap and the easing are
       both off so the rail tracks the hand exactly, and it glides to the
       nearest card when the hand lets go — the nearest CARD, because a
       card is 700px wide on a desktop and rounding a 300px push back to
       the nearest page would land it exactly where it started. A push
       worth more than a nudge lands on the next card the way it was
       heading, and a wheel steps a whole card per turn rather than the
       seventh of one a notch is actually worth. At either end the wheel
       is handed straight back to the page, so the section is something to
       scroll past rather than a trap to fall into.
       A card is its own dark surface, a 2:1 picture under a scrim, so it
       reads the same in all four themes without a per-theme repaint; only
       the heading and the dots take the page's tokens. The heading is a
       heading now — full weight, the page's own text colour — rather than
       the dimmed grey the smaller section labels wear, which at that size
       and tracking read as switched off.
       The words inside are sized against the CARD, not the window. The
       column count steps to two at 700px and the pair that arrives there
       is narrower than the single card a 390px phone was showing, so a
       viewport breakpoint never sees the tightest card on the site. They
       are container queries, with the phone case repeated as plain media
       queries so a browser without them still gets that much right.
       Checked at seventeen widths from 320 to 3440 across four themes:
       no card overflows its own 2:1 box at any of them. And 294 contrast
       measurements taken off the rendered pixels — every word scored
       against the lightest pixel actually behind it, over a near-white
       artwork, which is the worst thing a scrim can be asked to hold text
       over — none below 4.5:1, the weakest 6.3:1. Every way of moving the
       rail driven for real in a browser: a wheel notch moves one card and
       three move three, a drag follows the pointer and settles forward, a
       drag across a button does not fire it while a plain click still
       does, the dots and the arrow keys land on the page they name, and a
       wheel at the far end scrolls the gallery instead of stalling on it.
       Changed: index.html, css/hero.css, js/fgshow.js (new),
       js/app-core.js, sw.js.
   v131 — a legal document opened from Settings slides in, like everything
       else in that menu.
       Theme, Edit My Work, Wallet and My Purchases all open a page over
       the menu with a back arrow that returns to it. The legal rows were
       opening a modal instead — a sheet floating over a menu you could no
       longer see, closing to nowhere in particular. They now go through
       setGo the same way the rest do, into one #legalPage filled from
       js/legal-content.js.
       The footer keeps the modal. At the bottom of the home page there is
       no menu to go back to, and a sheet over the page is the right shape
       there. Both read the same documents, so there is still one copy of
       any of them, and the typography is written once — connect.css now
       carries .lmBody and .lgBdy on the same rules.
       The page element is looked up when it is used rather than when the
       script runs: #legalPage is written out below effects.js, so binding
       it early would have captured null and every row would have quietly
       navigated away instead of sliding.
       Changed: index.html, sw.js, css/profile.css, css/connect.css,
       js/effects.js.
   v130 — the precache list catches up with what the page actually loads.
       Eight assets had drifted: index.html asked for hero.css v87,
       overrides v5, upload v6, albums v8, drafts v2, mywork v8, pfedit v8
       and sections v80, while SHELL_URLS still named the versions before
       each of those. Both halves of that are a fault. The precache warms
       eight urls nobody requests, which is the exact waste v69 went and
       fixed; and the eight that ARE requested were never precached at
       all, so every one of them was a network round trip on a cold start
       and simply missing offline — the shell cache quietly not doing the
       one thing it exists for.
       Nothing here changes a version the page loads. index.html is the
       only place any of the eight is referenced, so it is the authority
       and sw.js was moved to agree with it, not the other way round.
       Changed: sw.js.
   v129 — the legal documents get addresses of their own, and a group in
       Settings.
       Privacy, Terms, Cookie, Refund and the Creator & Seller terms
       existed only as strings inside js/effects.js, shown in a modal by a
       footer button. Nothing outside the browser could reach them: not a
       crawler, and not the payment provider reviewing this domain, which
       asks to open a refund policy at a URL and wants a delivery timeline
       and a contact route before it will approve a site for live
       payments. Razorpay has been refusing payments on digiartz.net with
       "website does not match registered website(s)", and a policy set
       that cannot be read is the usual reason that review does not pass.
       The text moved to js/legal-content.js, which the modal and a new
       Pages Function both read, so a policy cannot say one thing in the
       modal and another on the page. Seven pages answer at /legal/<slug>,
       each self-contained — no stylesheet of ours, no scripts, nothing
       third-party, because a reviewer arrives on a cold cache with an ad
       blocker up. Two are new: a contact page, and a delivery policy
       saying digital goods arrive on payment confirmation and nothing is
       ever shipped.
       In Settings they are a group of their own, below the one carrying
       Log Out, in the same shape as the groups above it. The footer links
       and the cookie banner's became anchors over the same hrefs: the
       modal still opens on click, and where it cannot, the browser
       follows the link instead of doing nothing.
       Changed: index.html, sw.js, css/profile.css, js/effects.js,
       js/legal-content.js, functions/legal/[doc].js,
       functions/_middleware.js, functions/sitemap.xml.js.
   v128 — the buttons come up bright too, and the page is checked on
       every theme at every width.
       The Select and publish buttons were the two colours held back, on
       the grounds that white on a bright violet falls to about 2.7:1. The
       label goes to ink instead and the fill comes up with everything
       else. A fill and the type on it are one decision now, set as a pair
       and flipped by theme: bright violet with ink over the near-black,
       saturated violet with white over the light theme's page.
       The calendar stopped filling its selected day with the row's own
       colour. --fc is a different hue per row and each theme moves it, so
       a label on it would need its own ink twelve times over; the two
       filled things there take the accent, whose ink is set beside it.
       Two older faults surfaced under the same check, both light theme
       only: the required asterisk was a pale red on a pale card at 2.4:1,
       and the ghost draft slot's expiry chip was white on a 45% red at
       1.09:1 — the chip is neutral now, which is what an empty slot with
       no expiry should have said anyway.
       1072 contrast checks across four themes and four widths, none
       failing, nothing overflowing sideways.
       Changed: css/hero.css, css/upload.css, index.html, sw.js.
   v127 — the upload page's colours come up bright.
       Every colour on the page was mid-tone: legible, but flat against the
       near-black the page runs under. They move up a step — the field
       glyphs, the section chips, the dropzone's dashed edge and badge, and
       the green a chosen file is marked ready in.
       They are named now rather than typed out at each use: one --upc*
       token per role, set twice, because no single hex is bright on both
       the near-black and the light theme's white. The dark themes take the
       luminous step, the light theme the saturated one.
       Two colours stay put: the Select and publish buttons. They are fills
       with white type on them, and a violet bright enough to please the
       eye drops that type to about 2.7:1.
       Changed: css/hero.css, css/upload.css, index.html, js/sections.js,
       sw.js.
   v126 — the upload headline reads in the profile's blue.
       Upload Artwork, Share a Resource, List a Product, Write a Post and
       Post a Job all take the blue the profile's Edit Profile button
       wears. That button carries #2563EB as a fill with white on it, where
       it reads bright; as type on this page's near-black it goes muted, so
       the dark themes take the step above it and the light theme, whose
       ground is pale like the button's own white, takes the profile's
       exact value.
       Changed: css/overrides.css, css/upload.css, index.html, sw.js.
   v125 — the upload page, rebuilt.
       The bar is the profile's and the gallery's: the page's own mark and
       name on the left, one control on the right. That control is an (i),
       and it holds the guidelines and the visibility tips for whichever tab
       is open — they used to stand in a column beside the form and repeat
       themselves once per section, which cost a column and told a phone
       nothing until it had scrolled past the whole form.
       The tabs are the gallery's chips now, one colour per section, centred
       wherever the row fits and scrolled sideways where it does not.
       The form is one card: the dropzone at its head, then a row per detail
       with the field's own tinted glyph beside it, and the publish button
       outside the card so the page reads invite, details, act. Every text
       box grows to fit what is written in it rather than clipping it.
       Choosing a file now looks the way the marketplace picker already
       looked — a row naming the file, sizing it and saying it is ready —
       and that picked state is drawn in colour, green-edged, in both
       places. The empty zone's badge took the accent too; it was a white
       glyph on no background, invisible on the light theme.
       Every pick-from-a-list field opens the sheet's own menu instead of
       the platform's <select> popup, tinted to the row that opened it. The
       page is one column at every width, capped and centred on a desktop.
       Dead with it: the section form's <select> skin, which had three
       copies across hero.css, overrides.css and upload.css and no element
       left to paint; the two-up field row; select.upIn; and the heading
       rule for the guidance cards that moved into the sheet.
       Changed: css/hero.css, css/overrides.css, css/upload.css, index.html,
       js/albums.js, js/drafts.js, js/mywork.js, js/pfedit.js,
       js/sections.js, sw.js.
   v124 — even spacing round the tabs, a calmer switch, and Tags stops
       looking pressed.
       The gap above the chip row was 9px and the gap below it 35px. Both
       are one measure now, so the row sits the same distance from the
       header as the artwork sits from the row.
       Tags carried a filled pill and a dot whenever any tag was picked.
       A pick outlives the visit, so that read as a button held down for
       ever. It is drawn like every other control now; .on stays only as the
       hook the count is written into for a screen reader. The filter button
       keeps its dot, because a filter is set this visit and cleared the
       same way.
       The switch is one curve throughout, and the panel lifts six pixels
       rather than ten — the further a grid thousands of pixels tall is
       asked to travel, the more of it the compositor carries.
       Changed: css/hero.css, index.html, sw.js.
   v123 — the artwork comes off the wall on a phone.
       The grid took the home page's inset, which is a few pixels and reads
       as hard against the edge on a phone. It takes the profile's now,
       which is also the gallery bar's, so a thumbnail starts under the mark
       at every width — 16px on a phone, 24 on a desktop, and out to the
       centred grid's own edge past 1680.
       Changed: css/hero.css, index.html, sw.js.
   v122 — the gallery gets a header, and search gets a page.
       A search box held a whole line across the top of the gallery whether
       or not anyone was searching, and each of the six sections carried its
       own copy of it. All seven are gone. The bar is the profile's: the
       page's own mark and name on the left, and on the right the three
       controls that used to be scattered — search, filters, tags — in that
       order.
       Search is a page now, on the profile's pattern and its styles, but it
       looks in the whole site rather than one member's work: every approved
       artwork, and the listings, posts, resources and jobs beside them.
       Artwork is answered from the list the gallery already holds rather
       than by a query, so the results and the grid cannot disagree about
       what exists and anything hidden stays hidden. Scope chips narrow it,
       Tab is kept inside, and closing hands focus back.
       Six filter buttons became one. It opens whichever panel belongs to
       the section on show and wears the dot when that section is filtered.
       Tags leaves the chip row for the bar, so the row is six sections,
       one line, centred once there is room for it.
       Changed: index.html, css/hero.css, css/profile.css, css/overrides.css,
       js/search.js, js/gallery.js, js/app-core.js, sw.js.
   v121 — the bar rides up with the page, and switching a section is no
       longer a cut.
       The search box and the chips were pinned below the title and held a
       fifth of a phone screen for the whole scroll. They are in the flow
       now: they leave with the artwork and come back when you return to the
       top.
       Switching sections swapped one panel for another between two frames
       while the scroll snapped to the top in the same instant. The incoming
       panel rises in over 300ms, the way the home page's boards do, and the
       search box fades because only the words inside it change. The scroll
       reset now runs before the swap rather than after: the panel about to
       be shown is what decides the page's height, so resetting after it is
       drawn is a visible jump, and resetting first means it is only ever
       drawn at the top with the rise covering the move. The scroll itself
       cannot be animated — what it would travel through is the content
       being replaced.
       The chip row does glide, since the row it moves along is not being
       replaced. All of it stops under prefers-reduced-motion.
       Changed: css/hero.css, js/gallery.js, index.html, sw.js.
   v120 — four icons redrawn, and a gradient that erased two of them.
       A shopping bag for Marketplace and a trolley for Cart sat three
       chips apart saying the same thing; Marketplace is a storefront now
       and the trolley is Cart's alone. A pencil for Blog and an open book
       for Resources read closer to the other way round: Blog is an article
       and Resources is a stack of layers, which is what a page of brushes,
       textures and PSDs actually is. Tags was a 2x2 grid, which everywhere
       else on the web means a layout toggle; it is a price tag.
       Drawing them turned up a bug in how all seven are painted. The
       gradients were left in objectBoundingBox units, and the spec says an
       element whose bounding box has zero width or height is not rendered
       at all under those units. A perfectly horizontal line has no height,
       so Blog's three lines of text and the awning across the storefront
       were dropped on the floor. All seven now use userSpaceOnUse over the
       24x24 box, which also means one gradient runs across a whole icon
       rather than restarting on every path inside it.
       Changed: index.html, sw.js.
   v119 — Marketplace reads Market, and Jobs comes before Cart.
       The long word was the widest chip on the row and the one paying for
       it was the search box beside it. Short, the row drops from 818 to 783
       and stops scrolling from about 820 up rather than 1024.
       Jobs and Cart swap. Cart is where a visit ends, so it goes last, and
       the order is now the same in four places that have to agree: the chip
       row, the search boxes stacked above it, the panels below it, and the
       list the arrow keys walk.
       Changed: index.html, js/gallery.js, sw.js.
   v118 — the chips are named, and coloured like the feed boards.
       Icon-only asked a lot of six drawings — a shopping bag for
       Marketplace and a cart for Cart sat three chips apart and said much
       the same thing. Every chip carries its name now, and the chip itself
       is the home page's feed board borrowed whole: same surface, border,
       radius and weight of word, with the icon drawn in that entry's own
       gradient and the light theme's darker pair spelled out per chip. The
       two rails read as one family because they come from one recipe.
       Selected reads through the chip, not the icon — accent border over a
       tinted ground, as on the home page — so the icon keeps its colour and
       the row stays legible either way.
       Names make the row wider than a phone, so it is one line that scrolls
       there and one line that does not from about 1024 up. Nothing wraps,
       which is what lets the tablist stay a real element with Tags beside
       it rather than inside it. The scroll-into-view in fgSwitchSection is
       back with the scrolling, so a section opened from a quick link cannot
       land with its chip off the edge.
       Changed: index.html, css/hero.css, js/gallery.js, sw.js.
   v117 — every chip on one line, at every width, and never a scroll.
       The row scrolled sideways once the boxes stopped fitting, which on a
       phone meant the last section sat off the edge with nothing to say so.
       The seven boxes now take an equal share of whatever room there is and
       shrink into it: 56px each where there is space, down to about 30px at
       280px wide, one line throughout.
       Two grids rather than one, because Tags leads the row but is not one
       of the tabs and cannot live inside the tablist. Flattening the
       tablist with display:contents would have made one grid of all seven —
       and drops the tablist out of the accessibility tree, leaving six tabs
       with no owner, which was checked rather than assumed. So the row lays
       out seven equal columns, the tablist takes the last six, and repeats
       those six inside itself. Six columns spanning six columns come out
       the same width, so all seven match exactly.
       The scroll-into-view in fgSwitchSection goes with the scrolling: no
       chip can be off-screen for it to reach.
       Changed: css/hero.css, js/gallery.js, index.html, sw.js.
   v116 — Escape stopped part-way through closing overlays.
       The handler in js/pfedit.js ended with closeWalletPage(),
       closeBankPage() and closePurchasesPage(). None of the three has
       existed since the wallet, payout methods and purchases shells became
       one panel built by the signed-in module — that change updated the
       overlay lists in sections.js and app-core.js but not this line. So
       every Escape threw on the first name and never reached the other two.
       Nothing after them was lost, because they were last, but the panel
       that replaced all three had no way to be closed with Escape at all.
       It closes now. The panel owns its own close and the page cannot reach
       it by name, so store.js publishes the one handle, guarded because the
       panel is simply absent for a signed-out visitor. That close also
       hands the scroll lock back through restoreScroll() rather than
       clearing body overflow itself, and dzPanelHost joins the list
       restoreScroll checks — otherwise closing it over another open overlay
       unlocked the page under both.
       Changed: js/pfedit.js, js/app-core.js, functions/api/store.js, sw.js.
   v115 — Tags comes back, at the head of the chip row, and the picks now do
       what the picker always claimed.
       v114 took the tag rail out and the preferences with it. Tags is
       wanted, so it returns — not as a second row, but as the first box in
       the chip row, opening the same picker it always did. It is not one of
       the tabs: it switches no panel, so it sits outside the tablist and
       never takes the selected fill. It carries the filter button's dot
       instead, which is the only place a pick shows now that the rail is
       gone. The row is the scroller; the tablist inside it is not.
       The picker's own note says picked tags move matching artwork to the
       top. They never did — the only thing they moved was the order of the
       rail's own chips, and that rail is gone. The gallery grid now lifts
       artwork matching a picked tag above the rest, keeping the chosen
       sort's order within each group. So the sentence is true for the first
       time, and the control has an effect you can see.
       Changed: index.html, css/hero.css, css/widgets.css,
       css/overrides.css, js/gallery.js, js/app-core.js, js/auth.js, sw.js.
       Restored, trimmed to the picker: js/tagrail.js.
   v114 — the gallery gets one control block, and the grid reaches the edge.
       The section tabs were a text strip above the search box, and a rail
       of tag chips sat under it. That is two rows of navigation for one
       screen. The tabs are icon chips now and they sit below the search,
       so the gallery reads search, sections, artwork. On a screen long
       enough for both the two share a line; below that width the row
       breaks and they stack, holding one inset so the edges line up.
       The tag rail is gone with its preferences, its modal and
       js/tagrail.js. The ⌘K shortcut and its Ctrl hint were the only parts
       of that file worth keeping and have moved to js/search.js; the log's
       one call into tgLabel now goes to catLabel, which it should always
       have used. The saved rows in user_tag_prefs are left where they are.
       The grid took a 1.5rem inset from .fgBdy while the home page and the
       profile run their thumbnails to within a few pixels of the edge. It
       takes the home page's inset now, so the same artwork sits the same
       distance from the wall on all three.
       The chip row answers the arrow keys, Home and End, and is one stop
       in the tab order rather than six — the same treatment the profile
       tabs got in v113.
       Changed: index.html, css/hero.css, css/widgets.css,
       css/overrides.css, js/gallery.js, js/search.js, js/feed.js,
       js/auth.js, js/app-core.js, sw.js. Removed: js/tagrail.js.
   v113 — the profile tabs answer the arrow keys, and the search overlay
       keeps Tab inside it.
       The rail was seven separate stops in the tab order and had no
       arrow-key handling, which is not what role="tablist" promises. It
       is one stop now: the selected tab is the only one in the tab order,
       and Left, Right, Home and End move within, wrapping at both ends.
       Selection follows the arrow, which is right when the panel is
       already in the page and costs nothing to show. Up and Down are left
       alone — the rail is horizontal and they belong to the scroll.
       The search overlay covers the profile but does not remove it, so
       Tab walked off the end of the results and into the tabs, buttons
       and thumbnails still underneath. Tab now cycles inside the dialog
       in both directions, focus moves to the input when it opens, and
       whatever opened it gets focus back when it closes — except when the
       profile closed underneath it, where that control is gone too.
       Changed: js/profile.js, index.html, sw.js.
   v112 — js/profile.js and js/engagement.js changed in v111 and their
       query strings did not move with them, so a browser holding
       profile.js?v=7 or engagement.js?v=4 would have kept serving the
       versions without the fix. Bumped, and CACHE_VERSION with them.
   v111 — a second pass over the profile page, and two more found.
       The Likes and Views tiles had two writers and no winner.
       pfPaintStats sums the artwork rows it holds, which .limit(1000)
       caps, so it is an estimate. get_profile_engagement returns the real
       totals. Both wrote the same two elements and whichever reply landed
       last won, so the number depended on network timing. The database's
       answer now stamps the tile it filled, per profile, and the estimate
       yields to a stamped tile — so the same value ends up there whichever
       order they arrive in. They also format the same way now; one used
       toLocaleString and the other pfFmtCount, so the same figure could
       read 1,234 or 1.2K depending on who got there first.
       That writer was also looking members up by the wrong name. It took
       #pfUsername, which holds the display name whenever one is set, and
       queried profiles by username — so for anybody with a display name
       the lookup matched no row and the real totals never arrived. It
       reads #pfHandle now, and skips the lookup entirely when the open
       profile already knows its own id. It also wrote an em dash into
       both tiles before fetching, which left a dash sitting where a
       number had been on every failure. It no longer blanks anything.
       Second: the gallery's paging index did not move when a row moved.
       An upload puts a row on top and a delete takes one out, and both
       shift every window after them by one — so the index of what has
       been drawn and the count of what has been fetched have to shift
       too, or the next page repeats a row or steps over one. A deleted
       id also stayed in the index for good, which would have stopped that
       artwork from ever being drawn again. pfGalleryAdopt and
       pfGalleryForget keep both in step.
       Changed: js/engagement.js, js/albums.js, js/profile.js,
       js/mywork.js, js/upqueue.js, index.html, sw.js.
   v110 — createClient is called inside a try, and a correction.
       The number quoted in v108 and in its commit — roughly 36 of the 76
       functions touching sb do not check it — was wrong. It came from a
       line regex that called any function without a literal !sb
       unguarded, and never looked at try/catch. Counted properly, by
       matching braces and attributing each call to the function that
       actually contains it: 71 functions touch sb, 37 check it first, 33
       reach it only inside a try, and one — albFetchStrip — does neither,
       and even that one is awaited inside a try by both of its callers.
       Null sb was already safe everywhere. There was no sweep to do.
       So what shipped is the piece that was actually missing. createClient
       is called inside a try now, and both ways of having no backend — no
       config, or a client that would not construct — go through one
       dzNoBackend() that logs and raises the banner the site already had.
       sb stays null, which the audit above says the rest of the code
       knows how to be in. albFetchStrip gets an explicit guard, not
       because it breaks today but because it is the only one relying on
       every caller to be careful, and the next caller will not be.
       Verified three ways of losing the client — the script never
       arriving, createClient throwing, the global being undefined. All
       three: sb null, images initialised, app-core run to its end, banner
       shown, no errors on load and none while clicking through the
       profile, albums, gallery, notifications and settings.
       Changed: js/app-core.js, js/albums.js, index.html, sw.js.
   v109 — the auth handler did its bookkeeping behind a paint, and the
       paint threw on every first load.
       syncAuthBtn() ends by calling cpSyncAvatar(), which lives in
       js/mywork.js — seven script tags below js/auth.js — and the first
       auth event fires before that file is parsed. So the call threw,
       every visit. It was the second statement in the onAuthStateChange
       handler, so everything after it was skipped: the scope bump, every
       cache wipe, the read/unread marks, the localStorage purge, the
       hidden-artwork list and the tag preferences. A missing avatar chip
       was quietly cancelling the work that decides whose data is on
       screen.
       Two changes. The call is guarded — the chip it paints is on the
       community composer, which cpOpenChannel paints again when that bar
       is actually shown, so there was nothing to catch up on, only a
       throw to not do. And the handler is reordered: identity and the
       cache wipes are settled first, then everything that draws, each in
       its own try. Painting is allowed to fail; deciding whose data this
       is, is not.
       Boot is clean now — no page errors at all, verified with the CDN
       blocked and the vendored client serving.
       Changed: js/auth.js, index.html, sw.js.
   v108 — the backend client is served from here instead of from a CDN.
       The shell is precached down to the thumbnails, so a repeat visit
       works with no network — except for one file, fetched from jsdelivr
       on every visit, which app-core.js touches on line 315 before
       anything else. When it did not arrive, createClient threw there and
       took the rest of the file with it: the 62 function declarations
       below it still hoisted, so the page looked alive and answered
       clicks, while the 20 let/const bindings under it — images and
       filterCat among them — stayed in the temporal dead zone and threw
       on every access. Alive and dead at once, from a third party being
       slow.
       js/vendor/supabase-js-2.112.2.min.js is the same file jsdelivr was
       serving: the dist/umd/supabase.js that @supabase/supabase-js names
       in its own jsdelivr field, taken from the npm tarball, MIT, noted
       in ATTRIBUTIONS.md. It precaches with the rest of the shell, so
       there is no longer a request to anyone else on the critical path.
       The version is in the filename rather than a ?v= query, so an
       upgrade is a different path and no cache can answer with the old
       one.
       This does not harden line 315 — createClient is still called
       unguarded, and roughly 36 of the 76 functions that touch sb do not
       check it first. It removes the thing that was making that reachable.
       Changed: index.html, sw.js, ATTRIBUTIONS.md, js/vendor/ (new).
   v107 — the same leak, swept for everywhere else it could happen.
       The worst of it was on disk. dzcSet/dzcGet in js/app-core.js write
       offline snapshots to localStorage under a plain key with no owner
       recorded — and four of those keys are one member's: ownProfile,
       frMap, convos and frProfiles. Every one is read from a catch block,
       the fallback when a fetch fails, so on a shared device or after a
       second sign-in the next member was handed the last member's own
       profile row, friend map, conversation list and friend profiles the
       first time the network hiccuped. Unlike the caches in memory this
       survived a reload and a browser restart.
       A record now remembers who it was written for and is refused for
       anybody else. Public data — the artworks snapshot, the cp: channel
       logs — says so by name, so the default is the safe one and a cache
       key added later is scoped unless somebody decides otherwise. Old
       records carry no owner and are refused once. Signing out also
       deletes the scoped keys rather than leaving them to be refused.
       Two more in memory: notifReadIds kept the previous member's read
       marks when a reload failed, and frMap in js/dm.js — which decides
       whether a profile offers Add friend, Message or nothing — was left
       standing for 400ms after a sign-in while its reload was pending.
       Both are emptied at the moment the session changes.
       Audited and clean: only one query on the site pages server-side, so
       the unstable-sort fault has nowhere else to occur; there is no
       cursor pagination; dzArtistCache, avAuthorProfileCache,
       profileIdCache, awArtworksCache, logRows and the cp: logs are
       public data; dzCmLoad already guards with its own token; and the
       marketplace cache is already thrown away on a session change.
       Changed: js/app-core.js, js/auth.js, js/dm.js, index.html, sw.js.
   v106 — an artwork appeared twice, and one member's saves appeared under
       another member's name. Both were the same kind of mistake: the
       client trusting something it had no right to trust.
       The duplicates were the sort. The profile gallery is the one list
       on the site paged by the server, .range(from,to), ordered by
       created_at alone — and created_at is not unique. The upload queue
       writes several rows in the same instant, and rows that tie can come
       back in either order, so consecutive windows overlapped: some
       artworks landed in two pages and others in none. Ordering by id as
       well makes the sort total, so the windows tile exactly. The window
       now counts rows fetched rather than rows kept, and every id is
       remembered, so a row cannot be drawn twice whatever the server does.
       The saves were caches outliving their session. onAuthStateChange
       wiped pfRowCache and the community caches but not albMine,
       albMineLoaded, albTier, pf.albums or pfMediaCache — so after a
       second account signed in on the same tab, the albums page still
       held the first one's Likes and Bookmarks. engagement.js was worse:
       it waited 400ms before refetching, and on failure kept the previous
       member's sets, painting their filled hearts indefinitely.
       Rather than patch each call site, there is a scope stamp:
       dzScope() in js/app-core.js returns the signed-in id and a counter
       the session bump advances. A loader stamps what it is fetching for
       before it awaits and checks the stamp before it paints, so a reply
       that outlives its session is dropped instead of rendered. It guards
       the profile gallery, both album loaders and the like/bookmark sets.
       Changed: js/app-core.js, js/albums.js, js/auth.js, js/engagement.js,
       js/profile.js, index.html, sw.js.
   v105 — the profile bar reads PROFILE on every profile.
       It set itself in caps like every other page title on the site, and
       it stopped putting the viewed member's @handle there. The bar names
       the page, not the person on it — whose profile it is, is what the
       name under the banner says, and it said it twice. The mark is drawn
       on every profile for the same reason. Only the two things that act
       on your own account still move: the back arrow, which someone
       else's profile needs and yours does not, and search, the bell and
       the menu, which are yours. pfPaintTopBar lost its handle argument
       and #pfTopTitle and #pfTopMark lost their ids with it — nothing
       rewrites either one now.
       Changed: index.html, css/profile.css, js/profile.js, sw.js.
   v104 — one margin for the whole profile page.
       Edge to edge had been read literally: the tiles and the tab rail sat
       on a 5px gutter, the text on a 12px one and the artwork grid on a
       third, so five blocks started on five different lines and the
       thumbnails ran into the glass on a phone. There is one inset now —
       16px at 390, 24px from tablet up, and past 1280 it follows the
       1680px cap the grid already had, bars included. The artwork grid
       keeps the home grid's columns and gaps; only its margin changed.
       Both rails came to rest scrolled by exactly their own padding:
       scroll-snap-align:start snaps to the scrollport edge, which sits
       inside the padding, so the first tile and the first tab pressed
       against the edge whatever the margin said. scroll-padding-inline
       moves the snapport in to where the content starts.
       Changed: css/profile.css, sw.js, index.html.
   v103 — the profile page is rebuilt around a bar of its own.
       The top of it used to be the word PROFILE centred in a strip. It
       is now a bar: a profile mark on the left with the word Profile
       beside it, and on the right search, notifications and the menu
       that opens Settings. Those three act on your own account, so they
       are only drawn on your own profile — someone else's carries a
       back arrow and their @handle instead, which is also the first way
       out that page has ever had. The bell carries the same unread mark
       as the one on the home screen; notifRefreshBadge paints both.
       Search is scoped to one profile. It queries that artist's
       artwork, blog posts, listings and resources by name — nothing
       else on the site — with an All/section chip row, results grouped
       by section, and the results left standing behind whatever a row
       opens, so closing an artwork lands back on the search.
       Everything runs edge to edge. The body's 1100px cap is gone; the
       artwork grid is the same shape as the grid on the home screen,
       and past 1280 the identity block, the stat tiles and the tab rail
       hold that grid's 1680px edge so a tile, a tab and a thumbnail all
       start on one line.
       The header stats were a row of emoji separated by dots and were
       repeated again as cards in About. They are one row of six tiles
       now — artworks, likes, views, saves, cred, level — one line at
       every width, scrolling on a phone. Merit is not among them: it is
       a moderation score, so it reads in About with the sentence that
       explains it. About is Bio, Connect and Standing, with nothing the
       tiles already say.
       Removed with the old layout: the like and bookmark tab loaders,
       which had no tabs left to fill; the upload dropdown stubs and
       their outside-click listener, which watched a flag nothing set;
       the artwork card's title, date and tag markup, which was built on
       every card and hidden by three display:none rules; and the CSS
       for all of it.
       Changed: index.html, sw.js, css/profile.css, css/upload.css,
       css/community.css, css/select.css, js/profile.js, js/albums.js,
       js/auth.js, js/pfedit.js.
   v102 — Settings is grouped under five headings instead of one long list.
       Payments, Content, Activity, Account and Support, each with an
       emoji and a heading set larger than the rows under it, so the eye
       finds the group before it reads the items. The items are the same
       items and open the same pages — this is layout only. Every row is
       a full-width button with a chevron, so the whole line answers a
       tap rather than the words on it, and the rows are 52px on a phone,
       54px from tablet up, two columns of whole groups past 1000px.
       Two slots are filled by script rather than by markup, and both
       had to keep working: #setListGate, which /api/store fills with the
       four items index.html deliberately does not name, and a new
       #setAdmGate for the dev entry. Both are display:contents, so what
       lands in them lays out as rows of its group rather than as one
       block inside it. syncAdmBtn used to insert before the Log Out
       button as a sibling, which the nesting would have broken; it
       appends to the gate now, and still falls back to the flat list.
       Privacy & Security, Notifications and Help & Support are named in
       the Account and Support groups and marked SOON. They open nothing
       — there is nothing behind them yet — and say so on a tap.
       Log Out asks first. It is the last row of a list people scroll
       through for everything else, and it used to sign the member out on
       that one tap, with no way back except signing in again. It opens a
       confirmation now — Cancel and "Yes, log out" — and Cancel is what
       holds focus, what Escape does, and what a tap on the backdrop
       does. The sign-out itself is untouched; it moved into doLogout()
       and now runs only after the yes.
       Changed: index.html, sw.js, css/profile.css, js/auth.js,
       js/gallery.js.
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

const CACHE_VERSION = 'v172';
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
  '/css/hero.css?v=91',
  '/css/viewer.css?v=13',
  '/css/community.css?v=11',
  '/css/connect.css?v=2',
  '/css/ranking.css?v=2',
  '/css/profile.css?v=9',
  '/css/admin.css?v=1',
  '/css/auth.css?v=1',
  '/css/panels.css?v=3',
  '/css/upload.css?v=12',
  '/css/widgets.css?v=5',
  '/css/overrides.css?v=11',
  '/css/select.css?v=2',
  '/css/analytics.css?v=3',

  // the backend client. Cached like any other script now it is served from
  // here — the shell was fully offline-capable apart from this one file.
  '/js/vendor/supabase-js-2.112.2.min.js',

  // word list goes with the engine
  '/js/badwords-list-a.js?v=1',
  '/js/badwords-list-b.js?v=1',
  '/js/badwords.js?v=1',

  // scripts
  '/js/ranking.js?v=2',
  '/js/community.js?v=5',
  '/js/dm.js?v=8',
  '/js/composer.js?v=2',
  '/js/share.js?v=1',
  '/js/misc-core.js?v=5',
  '/js/app-core.js?v=22',
  '/js/protect.js?v=2',
  '/js/gallery.js?v=82',
  '/js/auth.js?v=10',
  '/js/profile.js?v=11',
  '/js/albums.js?v=14',
  '/js/drafts.js?v=6',
  '/js/upqueue.js?v=4',
  '/js/avatar.js?v=2',
  '/js/pfedit.js?v=9',
  '/js/mywork.js?v=18',
  '/js/startup.js?v=3',
  '/js/tagrail.js?v=3',
  '/js/search.js?v=9',
  '/js/feed.js?v=3',
  '/js/fgshow.js?v=4',
  '/js/effects.js?v=6',
  '/js/legal-content.js?v=1',
  '/js/cookie.js?v=1',
  '/js/zeo.js?v=1',
  '/js/theme.js?v=2',
  '/js/analytics.js?v=3',
  '/js/engagement.js?v=6',
  '/js/sections.js?v=106',
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
