/**
 * ═══════════════════════════════════════════════════════════════
 *  DigiArtz — AI Assistant ("Zeo") Data File
 *  aiAssistantData.js
 *
 *  This is the ONLY file you edit to change what Zeo knows.
 *  The chatbot engine in index.html reads window.ZEO_DATA and
 *  renders every screen dynamically — no engine changes needed.
 *
 *  FLOW (all built from the data below):
 *    Welcome  →  "Need Help?"  →  pick a TOPIC (categories)
 *             →  pick the PROBLEM you're facing (responses)
 *             →  Zeo walks you through it step by step (answer)
 *
 *  HOW TO EDIT
 *   • Add a topic  → push an object into `categories`
 *   • Add a Q&A    → add { question, answer } under responses[topicId]
 *   • `prompt`     → the "What are you facing?" line for that topic
 *   • Steps        → put each step on its own line inside the answer
 *                    (line breaks are preserved in the chat bubble)
 *   • Speech bubble→ leave `speechBubbles` empty [] to keep it OFF
 *
 *  NOTE: replace every [your contact email] below with your real
 *  support address before publishing.
 * ═══════════════════════════════════════════════════════════════
 */

window.ZEO_DATA = {

  /* ─────────────────────────────────────────────
     SCREEN 1 — Welcome (shown on open)
  ───────────────────────────────────────────── */
  welcomeMessage: "Hi, I'm Zeo — your DigiArtz assistant. Tell me what you need and I'll walk you through it one step at a time. Pick an option to begin.",

  /* Buttons under the welcome message.
     id "helpCenter" opens the topic menu.
     An id starting with "cat_" jumps straight into that topic. */
  welcomeOptions: [
    { id: "helpCenter",  label: "🧭 Get Help" },
    { id: "cat_contact", label: "✉️ Contact a Human" }
  ],

  /* ─────────────────────────────────────────────
     SCREEN 2 — Help Center (topic menu)
  ───────────────────────────────────────────── */
  helpCenterMessage: "What do you need help with? Choose a topic and I'll ask a couple of quick questions to get you to the right answer.",

  /* ─────────────────────────────────────────────
     TOPICS  (each: { id, icon, label, description, prompt })
     `prompt` is the "What are you facing?" line shown once the
     topic is opened, right above the list of problems.
  ───────────────────────────────────────────── */
  categories: [
    { id: "about",     icon: "💠", label: "About DigiArtz",        description: "What this place is and who made it.",       prompt: "What would you like to know about DigiArtz?" },
    { id: "navigation",icon: "🧭", label: "Getting Around",         description: "Find your way and reach any section.",       prompt: "What are you trying to find or reach?" },
    { id: "account",   icon: "🔑", label: "Account & Login",        description: "Sign up, log in, passwords, sign-out.",      prompt: "What's happening with your account?" },
    { id: "profile",   icon: "👤", label: "Profile & Customizing",  description: "Avatar, banner, bio, links, username.",      prompt: "What do you want to change on your profile?" },
    { id: "upload",    icon: "🎨", label: "Uploading Art",          description: "Post art & comics, tags, categories.",    prompt: "What do you need help with for your artwork?" },
    { id: "gallery",   icon: "🖼️", label: "Viewing & Interacting",  description: "Download, share, like, comment, report.",    prompt: "What would you like to do with an artwork?" },
    { id: "community", icon: "💬", label: "Community & Chat",       description: "Communities, comments, and messages.",       prompt: "Which part of the community do you need help with?" },
    { id: "billing",   icon: "💎", label: "Subscriptions & Refunds",description: "Plans, payments, refunds, cancelling.",      prompt: "What are you facing with billing or your plan?" },
    { id: "policies",  icon: "⚖️", label: "Policies & Legal",       description: "Privacy, Terms, Cookies, Refund policy.",     prompt: "Which policy would you like a quick summary of?" },
    { id: "safety",    icon: "🚩", label: "Safety & Reporting",     description: "Report content, harassment, stolen art.",    prompt: "What safety issue can I help with?" },
    { id: "trouble",   icon: "🛠️", label: "Technical Problems",     description: "Loading, saving, and display issues.",       prompt: "What's going wrong?" },
    { id: "contact",   icon: "✉️", label: "Contact a Human",        description: "Reach the DigiArtz team directly.",          prompt: "How would you like to reach us?" }
  ],

  /* ─────────────────────────────────────────────
     RESPONSES — keyed by topic id.
     Each: { question, answer }.  Keep answers as short,
     numbered steps rather than long paragraphs.
  ───────────────────────────────────────────── */
  responses: {

    /* ── ABOUT ─────────────────────────────── */
    about: [
      {
        question: "What is DigiArtz?",
        answer:
`DigiArtz is a digital art portfolio and community platform.

• Browse original art — characters, cars, landscapes and more
• Create a free account to post your own work
• Like, comment, and message other artists
• Follow the motto: "Art Has No Limits"

Head to the Home tab any time to start exploring.`
      },
      {
        question: "Who created DigiArtz?",
        answer:
`DigiArtz is created and run by KOE — a digital artist who builds every piece in Ibis Paint and also designs and codes the whole platform.

It's both KOE's personal portfolio and a space for the wider art community.`
      },
      {
        question: "Is it free to use?",
        answer:
`Yes — DigiArtz is free to browse and to post your art.

1. Tap Profile in the bottom bar
2. Create a free account (or log in)
3. Start uploading and interacting

Optional paid subscription tiers add extra perks — see the "Subscriptions & Refunds" topic for details.`
      },
      {
        question: "What can I do here?",
        answer:
`Here's what you can do on DigiArtz:

1. Explore art in the Gallery and Comic sections
2. Open any piece to download, share, like or comment
3. Upload your own art and comics from your Profile
4. Join Communities and chat with other artists
5. Message friends directly (DMs)

Pick any of those topics from the menu and I'll guide you.`
      }
    ],

    /* ── NAVIGATION ────────────────────────── */
    navigation: [
      {
        question: "What are the bottom bar buttons?",
        answer:
`The floating bar at the bottom is your main menu:

1. 🏠 Home — hero highlights + featured art
2. 🖼️ Gallery — all artworks
3. 📖 Comic — comic works
4. 💬 Community — communities, chat & friends
5. 👤 Profile — your account, uploads & settings

Tap any icon to jump straight to that section.`
      },
      {
        question: "How do I open the full gallery?",
        answer:
`To see every artwork in one place:

1. Tap 🖼️ Gallery in the bottom bar
2. Use the search box to find a title or tag
3. Scroll down and tap "Load More" to keep browsing
4. Tap any thumbnail to open it full-size

Use the category tabs (Characters, Sketch, Landscape) to filter.`
      },
      {
        question: "How do I find a specific artist?",
        answer:
`To reach an artist's profile:

1. Open any artwork they made
2. Tap their name or avatar at the top of the viewer
3. That opens their profile with all their art & comics

Tip: in Community → Friends you can also search people by username.`
      },
      {
        question: "How do I change the theme?",
        answer:
`To switch between Default, Dark and Light:

1. Go to the Profile tab
2. Open Settings
3. Choose your theme

Your choice is saved on this device and stays next time you visit.`
      }
    ],

    /* ── ACCOUNT & LOGIN ───────────────────── */
    account: [
      {
        question: "How do I sign up?",
        answer:
`Creating an account takes a minute:

1. Tap 👤 Profile in the bottom bar
2. Choose "Sign Up"
3. Enter a username, your email and a password
4. Submit — you're in!

Prefer one tap? Use Continue with Google, Discord or Apple instead.`
      },
      {
        question: "How do I log in?",
        answer:
`To log back in:

1. Tap 👤 Profile
2. Choose "Log In"
3. Enter your email and password, then submit

Or tap Google, Discord or Apple to sign in with that account.`
      },
      {
        question: "Log in with Google, Discord or Apple",
        answer:
`Social sign-in is the fastest way in:

1. Open Profile → Log In (or Sign Up)
2. Tap the Google, Discord or Apple button
3. Approve the sign-in in the pop-up
4. You'll return to DigiArtz already logged in

If a button says it isn't enabled yet, try email sign-in for now.`
      },
      {
        question: "I forgot my password",
        answer:
`If email sign-in won't work:

1. Double-check the email is spelled correctly
2. Make sure Caps Lock is off
3. If you still can't get in, contact us at [your contact email] from your registered email so we can help you reset it

Tip: if you originally joined with Google/Discord/Apple, use that same button instead of a password.`
      },
      {
        question: "How do I log out?",
        answer:
`To sign out of this device:

1. Go to the Profile tab
2. Open Settings
3. Tap "Log Out"

You'll stay logged out until you sign in again.`
      },
      {
        question: "Login isn't working",
        answer:
`Let's get you in:

1. Confirm your email and password are correct
2. Check your internet connection
3. Close and reopen the app/tab, then try again
4. If you used a social button before, use the same one now
5. Still stuck? Email [your contact email] with the username you're trying to reach

I won't ask for your password — never share it with anyone.`
      }
    ],

    /* ── PROFILE ───────────────────────────── */
    profile: [
      {
        question: "How do I edit my profile?",
        answer:
`To update your profile details:

1. Open the Profile tab
2. Tap "Edit Profile"
3. Change your bio, username or social links
4. Save your changes

Your updated info shows up right away.`
      },
      {
        question: "How do I change my avatar?",
        answer:
`To set a new profile picture:

1. Go to Profile → Edit Profile
2. Tap your avatar
3. Pick an image and drag to position it in the circle
4. Confirm to upload

Note: there's a short cooldown between avatar changes.`
      },
      {
        question: "How do I change my banner?",
        answer:
`To update your profile banner:

1. Go to Profile → Edit Profile
2. Tap the banner area
3. Choose an image and drag to frame it
4. Confirm to upload

Your old banner is replaced automatically.`
      },
      {
        question: "How do I add social links?",
        answer:
`To link your other accounts:

1. Open Profile → Edit Profile
2. Find the "Connect" fields (Instagram, YouTube, X, TikTok and more)
3. Paste your profile link into each one
4. Save

Only the links you fill in will appear on your profile.`
      },
      {
        question: "How do I change my username?",
        answer:
`To rename your account:

1. Go to Profile → Edit Profile
2. Edit the Username field
3. Save

If a name is taken, try a small variation. Your username is how others find and mention you.`
      }
    ],

    /* ── UPLOADING ART ─────────────────────── */
    upload: [
      {
        question: "How do I upload artwork?",
        answer:
`To post a new piece:

1. Go to your Profile tab
2. Tap "Upload" and choose Artwork
3. Pick your image
4. Add a title, description and tags
5. Choose the category and the software you used
6. Submit

Your art goes live in the public gallery immediately.`
      },
      {
        question: "How do I upload a comic?",
        answer:
`Posting a comic works the same way:

1. Profile tab → Upload → choose Comic
2. Select your comic image/page
3. Add a title, description and tags
4. Submit

It shows up under the Comic section right away.`
      },
      {
        question: "How do tags and software work?",
        answer:
`When uploading:

1. Add up to 10 tags that describe the piece (style, subject, colors)
2. Pick the software you used from the dropdown
3. Good tags help people discover your work in search

Keep tags relevant — spammy tags can get flagged.`
      },
      {
        question: "How do I edit or delete my art?",
        answer:
`To manage a piece you posted:

1. Open your Profile
2. Find the artwork in your gallery
3. Open it and use the manage options to update or remove it

If you can't find an option, email [your contact email] and we'll help.`
      },
      {
        question: "My upload failed",
        answer:
`If an upload won't go through:

1. Check your internet connection
2. Make sure the file is an image and not too large
3. Confirm you're logged in
4. Reload the page and try once more
5. Still failing? Contact [your contact email] with the file details

Large files are the most common cause — try a smaller export.`
      }
    ],

    /* ── GALLERY / INTERACTIONS ────────────── */
    gallery: [
      {
        question: "How do I download an artwork?",
        answer:
`To save a piece (when the artist allows it):

1. Tap the artwork to open the full-size viewer
2. Tap the Download button
3. The image saves to your device

If there's no Download button, that artist hasn't enabled downloads.`
      },
      {
        question: "How do I share an artwork?",
        answer:
`To share a piece with someone:

1. Open the artwork in the viewer
2. Tap the Share button
3. Copy the link or pick an app to share to

Please always keep the artist's credit intact when sharing.`
      },
      {
        question: "How do I like or bookmark art?",
        answer:
`To show love or save for later:

1. Open the artwork
2. Tap the like (heart) to support the artist
3. Tap bookmark to save it to your collection

You'll need to be logged in for these to stick.`
      },
      {
        question: "How do I comment on art?",
        answer:
`To leave a comment:

1. Open the artwork
2. Scroll to the comment area
3. Type your message (you can attach an image too)
4. Send

Keep it kind and constructive — that's what the community is about.`
      },
      {
        question: "How do I report an artwork?",
        answer:
`If a piece breaks the rules:

1. Open the artwork in the viewer
2. Tap the Report button
3. Tell us what's wrong and submit

Our team reviews reports and takes action when needed. For urgent issues, also email [your contact email].`
      }
    ],

    /* ── COMMUNITY & CHAT ──────────────────── */
    community: [
      {
        question: "How do communities work?",
        answer:
`Communities are topic rooms inside the Community tab:

1. Tap 💬 Community in the bottom bar
2. Pick a room (Art Talk, Feedback, Collab, Tips, Showcase…)
3. Read along, or post if you're logged in

Some rooms (like the Official one) are read-only announcements.`
      },
      {
        question: "How do I post in a community?",
        answer:
`To join the conversation:

1. Open a community room
2. Type in the message bar at the bottom
3. Send

In the Showcase room you attach one of your own artworks instead of plain text. Scroll up to load older messages.`
      },
      {
        question: "How do I message a friend (DMs)?",
        answer:
`To chat one-on-one:

1. Open the Community tab
2. Go to Friends
3. Tap a person to open your chat
4. Type and send (text only — links aren't allowed)

Scroll to the top of a chat to load older messages.`
      },
      {
        question: "How do I add friends?",
        answer:
`To connect with someone:

1. Community tab → Friends
2. Use the search box to find them by username
3. Open their chat and say hi

Starting a conversation adds them to your list automatically.`
      },
      {
        question: "What is Zeo?",
        answer:
`That's me! 🤖 I'm Zeo, the DigiArtz help assistant.

• I guide you through common tasks step by step
• Find me any time from the Community tab or my floating button
• I can't see your password or private data — I only help you navigate

Pick a topic and I'll take it from there.`
      }
    ],

    /* ── SUBSCRIPTIONS & REFUNDS ───────────── */
    billing: [
      {
        question: "What subscription tiers are there?",
        answer:
`DigiArtz offers a few membership tiers:

1. Open the Subscriptions overview on the site
2. Compare the tiers and their perks
3. Higher tiers unlock extra benefits and a badge

Browsing and posting stay free — subscriptions are optional.`
      },
      {
        question: "How do I subscribe?",
        answer:
`To start a subscription:

1. Open the Subscriptions section
2. Choose the tier you want
3. Follow the checkout steps to complete payment

Once done, your perks and badge activate on your account.`
      },
      {
        question: "I want a refund",
        answer:
`Please note our Refund Policy: subscription and digital purchases are generally final and non-refundable.

If you think your case is an exception (for example a billing error):

1. Gather your payment details / transaction ID
2. Email [your contact email] explaining what happened
3. We'll review and help where appropriate

See Policies → Refund Policy for the full terms.`
      },
      {
        question: "I was charged twice",
        answer:
`Sorry about that — let's sort it out:

1. Check your bank statement for the duplicate charge
2. Note both transaction IDs and dates
3. Email [your contact email] with those details
4. We'll investigate the double charge and refund the extra amount if it was on our side

We can't refund issues caused by your bank or a user-side error, but we'll always review.`
      },
      {
        question: "How do I cancel my subscription?",
        answer:
`To stop a subscription renewing:

1. Open your Profile / account area
2. Find your subscription details
3. Choose to cancel or turn off renewal

If you can't find the option, email [your contact email] before your next billing date and we'll assist.`
      }
    ],

    /* ── POLICIES ──────────────────────────── */
    policies: [
      {
        question: "Privacy Policy (summary)",
        answer:
`In short — our Privacy Policy covers:

1. What we collect (account info, content you post, usage & cookies)
2. How we use it (run the site, moderate, improve, show ads)
3. Who we share with (service providers, Google/ads, legal requests)
4. Your rights (access, correct, delete, opt out)

Read the full version any time from the footer → Privacy Policy.`
      },
      {
        question: "Terms & Conditions (summary)",
        answer:
`The Terms you agree to by using DigiArtz cover:

1. Who can use the platform and account responsibilities
2. That you keep ownership of your content (you grant us a licence to host/show it)
3. Community rules — no illegal, hateful, or infringing content
4. Moderation, advertising and limitation of liability

Full text: footer → Terms & Conditions.`
      },
      {
        question: "Cookie Policy (summary)",
        answer:
`Cookies help DigiArtz work and improve:

1. Essential cookies keep you signed in and secure
2. Preference cookies remember your settings (like theme)
3. Analytics cookies help us understand usage
4. Advertising cookies (incl. Google) support and measure ads

You can control cookies in your browser. Full text: footer → Cookie Policy.`
      },
      {
        question: "Refund Policy (summary)",
        answer:
`Key points of the Refund Policy:

1. Digital purchases and subscriptions are generally final
2. Refunds, exchanges and cancellations aren't guaranteed
3. Genuine billing errors (like double charges) will be reviewed
4. Contact support with your transaction details for any issue

Full text: footer → Refund Policy.`
      },
      {
        question: "How is my data used?",
        answer:
`Quick answer:

• We use your data to run your account, show your content, keep the site safe, and improve it
• We may show ads (including Google) which can use cookies
• We don't sell your personal info in the ordinary sense
• You can request access to or deletion of your data

For details and requests, see the Privacy Policy or email [your contact email].`
      }
    ],

    /* ── SAFETY & REPORTING ────────────────── */
    safety: [
      {
        question: "How do I report an artwork?",
        answer:
`To flag a piece that breaks the rules:

1. Open the artwork in the viewer
2. Tap Report
3. Describe the problem and submit

We review every report. For anything urgent, also email [your contact email].`
      },
      {
        question: "How do I report a user?",
        answer:
`If someone is behaving badly:

1. Note their username and what happened (screenshots help)
2. Email [your contact email] with the details
3. Our team will review and act per the community rules

We take harassment and abuse seriously.`
      },
      {
        question: "I'm being harassed",
        answer:
`I'm sorry that's happening. Here's what to do:

1. Don't engage further with the person
2. Save evidence (screenshots, usernames, dates)
3. Report it to [your contact email] right away

If you're ever in immediate danger offline, contact your local emergency services.`
      },
      {
        question: "Someone stole my art (copyright)",
        answer:
`To report content that infringes your rights:

1. Find the specific artwork on DigiArtz
2. Gather proof that the original is yours
3. Send a notice to [your contact email] with links and proof

We may remove infringing content and act on repeat offenders.`
      },
      {
        question: "Someone accessed my account",
        answer:
`Act quickly to secure it:

1. If you can still log in, change your password immediately
2. Log out of other devices where possible
3. Email [your contact email] from your registered email so we can help lock it down

Never share your password — DigiArtz staff and I will never ask for it.`
      }
    ],

    /* ── TECHNICAL ─────────────────────────── */
    trouble: [
      {
        question: "The site won't load",
        answer:
`Try these in order:

1. Check your internet connection
2. Refresh the page
3. Clear the cache or try a private/incognito window
4. Try another browser or device
5. If it's still down, wait a bit and retry

If it persists, let us know at [your contact email].`
      },
      {
        question: "Images won't load",
        answer:
`If artwork thumbnails are blank:

1. Refresh the page
2. Check your connection (images need more bandwidth)
3. Disable any ad/content blockers for this site
4. Try a different browser

Still blank? Tell us at [your contact email] what device and browser you're on.`
      },
      {
        question: "I see a flash or flicker on load",
        answer:
`A brief flash while the page starts up is usually harmless.

1. Fully refresh the page
2. Make sure you're on the latest version (clear cache)
3. If it keeps happening, note your device + browser and email [your contact email]

This helps us track down display quirks.`
      },
      {
        question: "My changes aren't saving",
        answer:
`If edits or uploads won't stick:

1. Confirm you're logged in
2. Check your connection
3. Wait for the confirmation before leaving the page
4. Reload and check if the change actually applied
5. Try once more, then contact [your contact email] if it repeats`
      },
      {
        question: "Something looks broken",
        answer:
`Thanks for spotting it! To report a visual bug:

1. Take a screenshot of the problem
2. Note your device, browser and what you were doing
3. Send it to [your contact email]

Details like these help us fix it fast.`
      }
    ],

    /* ── CONTACT ───────────────────────────── */
    contact: [
      {
        question: "Email support",
        answer:
`You can reach the DigiArtz team by email:

1. Write to [your contact email]
2. Include your username and a clear description
3. Attach screenshots if it helps

We'll get back to you as soon as we can.`
      },
      {
        question: "Report a bug",
        answer:
`Found a bug? Help us squash it:

1. Note what happened and how to trigger it
2. Add your device + browser
3. Attach a screenshot if you can
4. Send it to [your contact email]`
      },
      {
        question: "Business or collab inquiry",
        answer:
`For collaborations, commissions or business:

1. Email [your contact email]
2. Tell us who you are and what you have in mind
3. Include any relevant links or references

KOE reviews these personally.`
      }
    ]

  },

  /* ─────────────────────────────────────────────
     SPEECH BUBBLE
     Kept empty on purpose so the floating pop-up
     message next to Zeo's button stays OFF.
     (Add strings here again if you ever want it back.)
  ───────────────────────────────────────────── */
  speechBubbles: []

};
