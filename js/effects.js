/* ── effects.js · ripple, ads panel, legal modals, FAQ mount ── */
  /* Global ripple — fixed layer, pointer-events:none; animation applied inline after reflow */
  (function(){
    var host = document.getElementById('rippleHost');
    var SIZE = 40;          /* 40px — small click-acknowledgment dot */
    var HALF = SIZE / 2;
    var DUR  = 250;         /* ms */

    function spawnRipple(cx, cy){
      var el = document.createElement('div');
      el.style.position     = 'absolute';
      el.style.width        = SIZE + 'px';
      el.style.height       = SIZE + 'px';
      el.style.left         = (cx - HALF) + 'px';
      el.style.top          = (cy - HALF) + 'px';
      el.style.borderRadius = '50%';
      el.style.background   = 'rgba(var(--pg-rgb),0.9)';
      el.style.filter       = 'blur(2px)';   /* soft edges */
      el.style.pointerEvents= 'none';

      host.appendChild(el);
      void el.getBoundingClientRect();
      el.style.animation = 'rplGrow ' + DUR + 'ms ease-out both';

      setTimeout(function(){
        if(el.parentNode) el.parentNode.removeChild(el);
      }, DUR + 60);
    }

    /* FIX: on touch devices every tap fires touchstart AND a
       synthesized click ~300ms later — two overlapping ripples per
       tap. Remember the last touch and skip the click twin. */
    var lastTouch = 0;

    /* Mouse click — desktop, laptop, touchscreen laptop */
    document.addEventListener('click', function(e){
      if (Date.now() - lastTouch < 700) return;
      spawnRipple(e.clientX, e.clientY);
    }, {capture:true, passive:true});

    /* Touch — mobile, tablet, touchscreen laptop */
    document.addEventListener('touchstart', function(e){
      lastTouch = Date.now();
      for(var i = 0; i < e.changedTouches.length; i++){
        spawnRipple(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
      }
    }, {capture:true, passive:true});

  })();
  /* ── END GLOBAL RIPPLE ───────────────────────────────────────── */

/* IMAGE LINKED COMMENTS PATCH — UI helpers only; Supabase handled in main script */

(function(){
  var panel  = document.getElementById('adsPanel');
  var wrap   = document.getElementById('apTrackWrap');
  var dots   = document.querySelectorAll('#apDots .apDot');
  var cards  = document.querySelectorAll('#apTrack .apCard');
  var adsInit = false;

  /* ── Open ── */
  window.openAdsPanel = function(){
    closeMenu();
    panel.classList.add('open');
    var hint = panel.querySelector('.apHint');
    if (hint) {
      hint.style.animation = 'none';
      void hint.offsetWidth; // force reflow
      hint.style.animation = '';
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if(typeof zeoSectionTrigger==='function') zeoSectionTrigger();
    if(!adsInit){
      adsInit = true;
      setTimeout(function(){
        var slots = panel.querySelectorAll('ins.adsbygoogle');
        slots.forEach(function(ins, i){
          setTimeout(function(){
            try{ (adsbygoogle = window.adsbygoogle || []).push({}); }catch(e){}
          }, i * 150);
        });
      }, 800); /* staggered push — avoids main-thread freeze */
    }
  };

  /* ── Close ── */
  window.closeAdsPanel = function(){
    panel.classList.remove('open');
    /* FIX: consistent lock accounting via restoreScroll() */
    if (typeof restoreScroll === 'function') restoreScroll();
    else { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; }
  };

  /* ── Dot updater on scroll ── */
  function updateDots(){
    if(!wrap || !cards.length) return;
    var scrollLeft = wrap.scrollLeft;
    var cardW = cards[0].offsetWidth + 16; /* width + gap */
    var idx = Math.round(scrollLeft / cardW);
    idx = Math.max(0, Math.min(idx, cards.length - 1));
    dots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
  }
  if(wrap) wrap.addEventListener('scroll', updateDots, {passive:true});

  /* ── Dot click → scroll to card ── */
  dots.forEach(function(dot){
    dot.addEventListener('click', function(){
      var idx = parseInt(dot.getAttribute('data-idx'), 10);
      var cardW = cards[0] ? cards[0].offsetWidth + 16 : 0;
      wrap.scrollTo({ left: idx * cardW, behavior: 'smooth' });
    });
  });

  /* ── Mouse drag-to-scroll (desktop) ── */
  var isDragging = false, startX = 0, scrollStart = 0;
  if(wrap){
    wrap.addEventListener('mousedown', function(e){
      isDragging = true;
      startX = e.pageX - wrap.offsetLeft;
      scrollStart = wrap.scrollLeft;
      wrap.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', function(e){
      if(!isDragging) return;
      var x = e.pageX - wrap.offsetLeft;
      wrap.scrollLeft = scrollStart - (x - startX);
    });
    document.addEventListener('mouseup', function(){
      isDragging = false;
      if(wrap) wrap.style.cursor = 'grab';
    });
  }

  /* ── Close on Escape ── */
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && panel.classList.contains('open')) closeAdsPanel();
  });
})();

(function(){
  var CONTENT = {
    privacy: {
      title: 'PRIVACY POLICY',
      html: `<h2>DigiArtz Privacy Policy</h2>
<p><strong>Effective Date:</strong> 6 July 2026</p>
<p>DigiArtz ("we," "us," "our") operates digiartz.net as an artist community platform. This Privacy Policy explains how we collect, use, store, share, and protect information when you use our website, services, and community features.</p>
<p>By using DigiArtz, you agree to this Privacy Policy.</p>
<h3>1. Information We Collect</h3>
<p>We may collect the following types of information:</p>
<h4>Information you provide directly</h4>
<ul>
<li>Account details such as your name, username, email address, profile photo, and password.</li>
<li>Content you upload or post, including artwork, captions, comments, messages, and profile information.</li>
<li>Information you send us through forms, support requests, surveys, or email.</li>
<li>Payment or billing information, if we ever offer paid features, memberships, or purchases.</li>
</ul>
<h4>Information collected automatically</h4>
<ul>
<li>Device information, browser type, operating system, IP address, language, and approximate location.</li>
<li>Log data, including pages visited, time spent on pages, clicks, referral links, and the date and time of access.</li>
<li>Cookies, pixels, tags, and similar technologies.</li>
<li>Advertising and analytics data, including ad impressions, ad interactions, and campaign performance.</li>
</ul>
<h4>Information from third parties</h4>
<ul>
<li>Analytics providers, advertising partners, and social sign-in services, where applicable.</li>
<li>Publicly available information or content shared through connected platforms.</li>
</ul>
<h3>2. How We Use Information</h3>
<p>We use information to:</p>
<ul>
<li>Create and manage user accounts.</li>
<li>Display, host, and share artwork and community content.</li>
<li>Personalize the website and improve user experience.</li>
<li>Moderate content, prevent abuse, and enforce our Terms and community rules.</li>
<li>Send important service messages, security alerts, and updates.</li>
<li>Respond to support requests.</li>
<li>Measure traffic, performance, and engagement.</li>
<li>Show advertising, including Google ads and other ad partners.</li>
<li>Comply with legal obligations and protect our rights, users, and platform.</li>
</ul>
<h3>3. Google Ads and Advertising</h3>
<p>We may display ads through Google and other advertising partners.</p>
<p>Google and its partners may use cookies and similar technologies to serve ads based on your visit to our website and/or other websites on the internet. Ads may be personalized or non-personalized depending on your settings, location, consent choices, and applicable law.</p>
<p>You can manage Google ad personalization through Google's Ads Settings. Even if you turn off personalized ads, you may still see ads based on general factors such as your browser type, approximate location, or the content you are viewing.</p>
<p>We may also use ad measurement and frequency-capping tools so ads are not shown too often.</p>
<h3>4. Cookies and Similar Technologies</h3>
<p>We use cookies and similar technologies for:</p>
<ul>
<li>Essential site functions</li>
<li>Remembering preferences and login sessions</li>
<li>Understanding how people use DigiArtz</li>
<li>Improving performance</li>
<li>Advertising and ad measurement</li>
</ul>
<p>You can control cookies through your browser settings and, where available, through our cookie banner or preference tools. Some cookies are required for the website to work properly, and disabling them may affect functionality.</p>
<h3>5. How We Share Information</h3>
<p>We may share information with:</p>
<ul>
<li>Service providers that help us run the website, host content, send emails, analyze traffic, or serve ads.</li>
<li>Google and other advertising/analytics partners.</li>
<li>Law enforcement, regulators, or other parties when required by law or when necessary to protect rights, safety, or security.</li>
<li>Another organization if DigiArtz is involved in a merger, acquisition, reorganization, or sale of assets.</li>
</ul>
<p>We do not sell your personal information in the ordinary sense of the word, unless we clearly disclose a specific sale or sharing arrangement and the law requires a choice.</p>
<h3>6. User Content</h3>
<p>Anything you upload publicly on DigiArtz may be visible to other users and visitors.</p>
<p>Please do not post anything you do not want others to see, copy, or share. Once content is shared publicly, it may be difficult or impossible to remove it completely from the internet.</p>
<h3>7. Your Choices and Rights</h3>
<p>Depending on where you live, you may have the right to:</p>
<ul>
<li>Access the personal information we hold about you</li>
<li>Correct inaccurate information</li>
<li>Delete certain information</li>
<li>Object to or restrict some processing</li>
<li>Withdraw consent where processing is based on consent</li>
<li>Opt out of marketing or certain ad personalization</li>
</ul>
<p>To make a privacy request, contact us at [your contact email].</p>
<p>If you are located in the EEA, UK, or other regions with similar laws, you may also have additional rights under local law.</p>
<h3>8. Data Retention</h3>
<p>We keep personal information only as long as needed for the purposes described in this policy, including account management, legal compliance, dispute resolution, security, and platform operations.</p>
<p>When information is no longer needed, we will delete, anonymize, or securely retain it only as required by law.</p>
<h3>9. Security</h3>
<p>We use reasonable technical and organizational measures to help protect your information. No website or internet-based service can be fully secure, so we cannot guarantee absolute security.</p>
<h3>10. Children's Privacy</h3>
<p>DigiArtz is not intended for children under the age of 13, and in some places higher age limits may apply under local law.</p>
<p>If we learn that we have collected personal information from a child without appropriate consent, we will take steps to delete it.</p>
<h3>11. International Users</h3>
<p>If you access DigiArtz from outside the country where our servers or service providers are located, your information may be transferred and processed in other countries with different data protection rules.</p>
<h3>12. Third-Party Links and Services</h3>
<p>Our website may contain links to other websites, embedded content, or third-party services. We are not responsible for the privacy practices of those third parties.</p>
<h3>13. Changes to This Policy</h3>
<p>We may update this Privacy Policy from time to time. When we do, we will post the updated version on this page and revise the effective date above.</p>
<h3>14. Contact Us</h3>
<p>If you have any questions or requests about this Privacy Policy, contact us at:</p>
<p>Email: [your contact email]<br>Website: digiartz.net</p>
<span class="lmDate">EFFECTIVE DATE: 6 JULY 2026</span>`
    },
    terms: {
      title: 'TERMS &amp; CONDITIONS',
      html: `<h2>DigiArtz Terms and Conditions</h2>
<p><strong>Effective Date:</strong> 6 July 2026</p>
<p>These Terms and Conditions ("Terms") govern your use of DigiArtz and all related pages, features, and services on digiartz.net.</p>
<p>By using DigiArtz, you agree to these Terms. If you do not agree, do not use the website.</p>
<h3>1. Who Can Use DigiArtz</h3>
<p>You must be legally able to enter into a binding agreement where you live. If you are under the minimum age required by law in your country, you may not use the service without appropriate permission from a parent or guardian, if allowed by law.</p>
<h3>2. Accounts</h3>
<p>If you create an account, you agree to:</p>
<ul>
<li>Provide accurate information</li>
<li>Keep your login details private</li>
<li>Be responsible for activity under your account</li>
<li>Notify us if you suspect unauthorized use</li>
</ul>
<p>We may suspend or close accounts that violate these Terms or put the community at risk.</p>
<h3>3. Your Content</h3>
<p>You keep ownership of the content you create and upload.</p>
<p>By posting content on DigiArtz, you give us a non-exclusive, worldwide, royalty-free, transferable, sublicensable license to host, store, reproduce, display, distribute, adapt, promote, and make technical changes to your content as needed to operate, improve, and promote the platform.</p>
<p>This license ends when your content is removed from DigiArtz, except where:</p>
<ul>
<li>Other users have shared or re-posted it,</li>
<li>We need to keep copies for legal, security, backup, or compliance reasons, or</li>
<li>The content was already used in advertising, previews, or archived systems.</li>
</ul>
<p>You are responsible for making sure you have the rights to post any artwork, images, text, music, fonts, or other material you upload.</p>
<h3>4. Copyright and Intellectual Property</h3>
<p>Do not upload content that violates someone else's copyright, trademark, privacy, or other rights.</p>
<p>If you believe content on DigiArtz infringes your rights, contact us with a proper notice at [your contact email] and include enough details for us to review the claim.</p>
<p>We may remove content, limit access, or disable accounts if we believe infringement or repeat infringement has occurred.</p>
<h3>5. Community Rules</h3>
<p>You agree not to use DigiArtz to:</p>
<ul>
<li>Post illegal, hateful, harassing, abusive, threatening, or defamatory content</li>
<li>Upload spam, scams, malware, phishing links, or harmful code</li>
<li>Pretend to be another person or mislead users about your identity</li>
<li>Scrape, copy, or harvest data without permission</li>
<li>Interfere with the website, servers, or security systems</li>
<li>Reverse engineer or attempt unauthorized access to the service</li>
<li>Post adult or offensive material where it is not allowed</li>
<li>Use the platform in any way that breaks the law or harms others</li>
</ul>
<p>We may remove content or take action at our discretion if content appears unsafe, unlawful, misleading, or harmful to the community.</p>
<h3>6. Moderation</h3>
<p>We may review, filter, edit, hide, move, or remove content if we believe it violates these Terms, our policies, or community standards.</p>
<p>We are not obligated to monitor every post, but we may act when we become aware of a problem.</p>
<h3>7. Advertising</h3>
<p>DigiArtz may display advertisements, including Google ads and ads from other partners.</p>
<p>We do not control every third-party advertisement, offer, or landing page. Clicking an ad is between you and the advertiser. Any deal, product, or service from a third party is governed by that third party's terms and privacy policy.</p>
<h3>8. Third-Party Services</h3>
<p>The website may use third-party services for analytics, hosting, payments, login, embeds, or advertising. We are not responsible for the actions or policies of those third parties.</p>
<h3>9. Prohibited Use of the Platform</h3>
<p>You may not:</p>
<ul>
<li>Use bots or automated systems to abuse the service</li>
<li>Attempt to bypass access restrictions</li>
<li>Copy or clone the site or its features without permission</li>
<li>Use DigiArtz to distribute viruses, spam, or deceptive content</li>
<li>Collect user data without consent</li>
<li>Use the service for unlawful commercial activities</li>
</ul>
<h3>10. Disclaimer</h3>
<p>DigiArtz is provided on an "as is" and "as available" basis.</p>
<p>We do not promise that:</p>
<ul>
<li>The website will always be available, secure, or error-free</li>
<li>Every post or upload will be preserved forever</li>
<li>Every piece of content on the platform is accurate or lawful</li>
</ul>
<p>Use the site at your own risk.</p>
<h3>11. Limitation of Liability</h3>
<p>To the fullest extent allowed by law, DigiArtz and its owners will not be liable for indirect, incidental, special, or consequential damages, including loss of data, profits, reputation, or business opportunities, arising from your use of the website.</p>
<h3>12. Indemnity</h3>
<p>You agree to protect and hold harmless DigiArtz and its owners from claims, damages, liabilities, losses, and expenses arising from your content, your use of the website, or your violation of these Terms.</p>
<h3>13. Termination</h3>
<p>We may suspend or terminate your access to DigiArtz at any time if we believe you violated these Terms, created risk, or harmed the platform or its users.</p>
<p>You may stop using the service at any time.</p>
<h3>14. Changes to the Terms</h3>
<p>We may update these Terms from time to time. Continued use of DigiArtz after changes are posted means you accept the updated Terms.</p>
<h3>15. Governing Law</h3>
<p>These Terms will be governed by the laws of [your country/state], unless local law requires otherwise.</p>
<h3>16. Contact</h3>
<p>Questions about these Terms can be sent to:</p>
<p>Email: [your contact email]<br>Website: digiartz.net</p>
<span class="lmDate">EFFECTIVE DATE: 6 JULY 2026</span>`
    },
    cookie: {
      title: 'COOKIE POLICY',
      html: `<h2>DigiArtz Cookie Policy</h2>
<p><strong>Effective Date:</strong> 6 July 2026</p>
<p>This Cookie Policy explains how DigiArtz uses cookies and similar technologies on digiartz.net.</p>
<h3>1. What Cookies Are</h3>
<p>Cookies are small files stored on your device when you visit a website. They help websites remember your settings, understand how the site is being used, and deliver content and ads.</p>
<p>We may also use pixels, tags, local storage, and similar technologies.</p>
<h3>2. Why We Use Cookies</h3>
<p>We use cookies for several reasons:</p>
<h4>Essential cookies</h4>
<ul>
<li>Help the site function properly</li>
<li>Keep you signed in</li>
<li>Remember security and session information</li>
</ul>
<h4>Preference cookies</h4>
<ul>
<li>Remember language, layout, and display settings</li>
</ul>
<h4>Analytics cookies</h4>
<ul>
<li>Understand how visitors use the site</li>
<li>Measure performance and improve the platform</li>
</ul>
<h4>Advertising cookies</h4>
<ul>
<li>Show ads</li>
<li>Measure ad performance</li>
<li>Limit how often you see the same ad</li>
<li>Support personalized or non-personalized advertising</li>
</ul>
<h3>3. Google Ads Cookies</h3>
<p>We may use Google advertising services on DigiArtz.</p>
<p>Google and its partners may use cookies to:</p>
<ul>
<li>Serve ads based on your visit to DigiArtz and other websites</li>
<li>Measure ad performance</li>
<li>Personalize ads where permitted</li>
<li>Limit repeated ad exposure</li>
</ul>
<p>You can manage Google ad personalization in Google's Ads Settings. Depending on your settings and local law, you may also see non-personalized ads.</p>
<h3>4. Cookie Choices</h3>
<p>You can control cookies in several ways:</p>
<ul>
<li>Use your browser settings to block or delete cookies</li>
<li>Use our cookie banner or consent tools, if shown</li>
<li>Adjust Google ad settings for personalized ads</li>
<li>Clear stored site data from your device</li>
</ul>
<p>If you block essential cookies, some parts of DigiArtz may not work correctly.</p>
<h3>5. Third-Party Cookies</h3>
<p>Some cookies may be set by third-party services such as:</p>
<ul>
<li>Google</li>
<li>Analytics providers</li>
<li>Embedded media services</li>
<li>Social login or sharing tools</li>
</ul>
<p>Those third parties control their own cookies and policies.</p>
<h3>6. Updates to This Policy</h3>
<p>We may update this Cookie Policy from time to time. Changes will appear on this page with a revised effective date.</p>
<h3>7. Contact</h3>
<p>Questions about this Cookie Policy can be sent to:</p>
<p>Email: [your contact email]<br>Website: digiartz.net</p>
<span class="lmDate">EFFECTIVE DATE: 6 JULY 2026</span>`
    },
    refund: {
      title: 'REFUND POLICY',
      html: '<h2>Refund Policy for Digiartz</h2>' +
        '<p>Due to the nature of our digital services and content, all purchases are final and non-refundable. Once a subscription, digital product, or service has been purchased, we are unable to provide refunds, exchanges, or cancellations.</p>' +
        '<p>Please review all details carefully before completing your purchase. If you experience a billing error, such as being charged multiple times for the same transaction, contact our support team and we will investigate the issue and provide assistance where appropriate.</p>' +
        '<p>By making a purchase on our website, you acknowledge and agree to this Refund Policy.</p>' +
        '<span class="lmDate">LAST UPDATED: JUNE 2026</span>'
    }
  };

  var backdrop = document.getElementById('legalBackdrop');
  var titleEl  = document.getElementById('lmTitleText');
  var bodyEl   = document.getElementById('lmBody');
  /* Local escaper — this script runs in its own IIFE, separate from
     the main app scope's esc(), so it can't reach that one. */
  function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  window.openLegal = function(type){
    var c = CONTENT[type];
    if(!c) return;
    titleEl.innerHTML = c.title;
    bodyEl.innerHTML  = c.html;
    bodyEl.scrollTop  = 0;
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    /* focus the close button for a11y */
    var closeBtn = backdrop.querySelector('.lmClose');
    if(closeBtn) setTimeout(function(){ closeBtn.focus(); }, 80);
  };

  window.closeLegal = function(){
    backdrop.classList.remove('open');
    /* FIX: the legal backdrop is also reused by the verification-status
       modal, which opens on top of My Work / Profile — a blind overflow
       reset unlocked background scroll behind those still-open panels.
       restoreScroll() only unlocks when nothing else is open. */
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
  };

  /* ── Verification-status modal — shown when a submitter taps their
     own blurred, still-pending artwork. Reuses the legal modal's
     backdrop/card/theme so it looks native to the rest of the site. ── */
  window.handleBackdropClick = function(e){
    if(e.target === backdrop) closeLegal();
  };

  /* Close on Escape */
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && backdrop.classList.contains('open')) closeLegal();
  });

})();

(function(){

  /* ── Mount FAQ into the subscription page body ── */
  function mountFaq(){
    var faqEl  = document.getElementById('faqSection');
    var subBdy = document.querySelector('.subPgBdy');
    if(!faqEl || !subBdy){ return; }
    /* Remove hidden attribute set during initial parse (FAQ is outside subPage) */
    faqEl.removeAttribute('hidden');
    subBdy.appendChild(faqEl);
    /* Reveal answer panels that were hidden so ARIA hidden attr is removed */
    var panels = faqEl.querySelectorAll('.faqA[hidden]');
    panels.forEach(function(p){ p.removeAttribute('hidden'); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFaq);
  } else {
    mountFaq();
  }

  /* ── Toggle accordion item ── */
  window.faqToggle = function(btn){
    var item   = btn.closest('.faqItem');
    var panel  = document.getElementById(btn.getAttribute('aria-controls'));
    var icon   = btn.querySelector('.faqIcon');
    var isOpen = item.classList.contains('faq--open');

    /* Collapse all open items in the same section */
    var section = item.closest('.faqCategory');
    if(section){
      section.querySelectorAll('.faqItem.faq--open').forEach(function(openItem){
        if(openItem === item) return;
        var ob  = openItem.querySelector('.faqQ');
        var op  = openItem.querySelector('.faqA');
        var oi  = openItem.querySelector('.faqIcon');
        openItem.classList.remove('faq--open');
        if(ob) ob.setAttribute('aria-expanded','false');
        if(oi) oi.textContent = '+';
      });
    }

    /* Toggle the clicked item */
    if(isOpen){
      item.classList.remove('faq--open');
      btn.setAttribute('aria-expanded','false');
      if(icon) icon.textContent = '+';
    } else {
      item.classList.add('faq--open');
      btn.setAttribute('aria-expanded','true');
      if(icon) icon.textContent = '+'; /* stays + , CSS rotate handles × look */
    }
  };

  /* ── Keyboard navigation within a category ── */
  document.addEventListener('keydown', function(e){
    var btn = e.target;
    if(!btn || !btn.classList.contains('faqQ')) return;

    var section = btn.closest('.faqCategory');
    if(!section) return;

    var btns = Array.from(section.querySelectorAll('.faqQ'));
    var idx  = btns.indexOf(btn);

    switch(e.key){
      case 'ArrowDown':
        e.preventDefault();
        if(idx < btns.length - 1) btns[idx + 1].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if(idx > 0) btns[idx - 1].focus();
        break;
      case 'Home':
        e.preventDefault();
        btns[0].focus();
        break;
      case 'End':
        e.preventDefault();
        btns[btns.length - 1].focus();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        faqToggle(btn);
        break;
    }
  });

})();
