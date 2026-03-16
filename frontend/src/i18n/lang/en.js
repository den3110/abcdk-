export default {
  common: {
    languageName: "English",
    languages: {
      vi: "Tiếng Việt",
      en: "English",
    },
    openArticle: "Open article",
    unavailable: "—",
    updatedAt: "Updated: {date}",
    labels: {
      address: "Address",
      phone: "Phone",
      hotline: "Hotline",
      email: "Email",
      statusCode: "Status code",
      requestId: "Request ID",
      time: "Time",
    },
    actions: {
      send: "Send",
      save: "Save",
      cancel: "Cancel",
      back: "Back",
      backHome: "Back home",
      retry: "Retry",
      reload: "Reload",
      contactSupport: "Contact support",
      openContact: "Open contact page",
      downloadApp: "Download app",
      openApp: "Open app",
      close: "Close",
      delete: "Delete",
      edit: "Edit",
      apply: "Apply",
      refresh: "Refresh",
      reset: "Reset",
      clear: "Clear",
      manage: "Manage",
      login: "Log in",
      create: "Create",
      review: "Review",
      approve: "Approve",
      reject: "Reject",
      previous: "Previous",
      next: "Next",
      view: "View",
      open: "Open",
      connect: "Connect",
      default: "Default",
    },
    appStores: {
      appStore: "App Store",
      googlePlay: "Google Play",
    },
    states: {
      loading: "Loading...",
      noData: "No data",
      noResults: "No results found",
      notUpdated: "Not updated",
      on: "On",
      off: "Off",
      all: "All",
      page: "Page {current}/{total}",
    },
  },
  header: {
    nav: {
      tournaments: "Tournaments",
      rankings: "Ratings",
      news: "News",
      myTournaments: "My Events",
      clubs: "Clubs",
      live: "Live",
      admin: "Admin",
    },
    actions: {
      back: "Back",
      lightMode: "Light mode",
      darkMode: "Dark mode",
      account: "Account",
      profile: "Profile",
      logout: "Log out",
      login: "Log in",
      register: "Sign up",
    },
    liveCount: "{count} live matches",
  },
  mobileNav: {
    home: "Home",
    tournaments: "Events",
    news: "News",
    rankings: "Ratings",
    mine: "Mine",
    profile: "Profile",
    clubs: "Clubs",
    admin: "Admin",
  },
  footer: {
    description:
      "A pickleball platform for tournaments, community, and live match experiences, designed to make events easier to follow and easier to manage.",
    supportLabel: "Legal and operations support:",
    quickLinks: "Quick links",
    policies: "Policies",
    links: {
      news: "News",
      clubs: "Clubs",
      contact: "Contact",
      cookies: "Cookies",
      privacy: "Privacy",
      terms: "Terms",
    },
    rights: "© {year} PickleTour. All rights reserved.",
    compliance: "Transparent about data, privacy, and terms of use.",
  },
  seo: {
    defaultTitle: "PickleTour.vn - Community and Tournament Platform",
    defaultDescription:
      "Vietnam's leading pickleball tournament platform. Register for events, follow rankings, watch live matches, and stay connected with the community.",
    defaultKeywords:
      "pickleball, pickleball tournaments, pickleball rankings, pickletour, sports, tournament platform, vietnam pickleball, register tournament, pickleball ratings",
    ogLocale: "en_US",
  },
  news: {
    badges: {
      aiEdited: "AI Edited",
      community: "Community",
    },
    list: {
      seoTitle: "Pickleball News - PickleTour",
      seoDescription:
        "Latest pickleball news, practical insights, and tournament updates from the community and PickleTour AI.",
      seoKeywords:
        "pickleball news, pickleball knowledge, pickleball tournaments, pickleball blog, pickleball rules",
      hero: {
        eyebrow: "PickleTour News",
        title: "PickleTour News",
        description:
          "Community-driven updates and practical stories about events, club operations, communications, and pickleball websites.",
        publishedCount: "{count} published posts",
        suggestedCount: "{count} personalized picks",
        latestDate: "Latest: {date}",
        readLatest: "Read latest story",
        viewHighlights: "Browse highlights",
        note:
          "AI is only part of the workflow. Stories are still filtered by topic relevance, reviewed, and prioritized for usefulness before they appear here.",
        previewFallbackTitle: "Curated pickleball stories, every day",
        previewFallbackSummary:
          "Follow community news, strategy, event communication, and filtered AI explainers in one place.",
      },
      loadError: "Unable to load the news feed.",
      empty: "No published stories yet.",
      suggestedTitle: "Suggested for you",
      suggestedFallback: "Suggested",
      featuredTitle: "Featured story",
      latestTitle: "Latest stories",
      pendingImage: "Generating cover...",
      readMore: "Read more",
    },
    detail: {
      seoSuffix: "PickleTour News",
      backToNews: "Back to news",
      loadError: "Unable to load this article. Please try again later.",
      aiSource: "PickleTour AI Agent",
      externalSource: "External source",
      pendingImage: "Generating article cover...",
      suggestedTitle: "Suggested for you",
      suggestedFallback: "Suggested",
      suggestedOpenFallback: "Open the article to view details",
      viewSource: "Open original source",
    },
  },
  auth: {
    login: {
      seoTitle: "Log in",
      welcome: "Welcome back to PickleTour!",
      subtitle: "Sign in to your account",
      identifierLabel: "Phone number or Email",
      passwordLabel: "Password",
      submit: "Log in",
      forgot: "Forgot password?",
      register: "Create account",
      errors: {
        failed: "Login failed",
      },
    },
    register: {
      seoTitle: "Sign up",
      seoDescription:
        "Create a Pickletour.vn account to join tournaments, track your rating, and stay connected with the community.",
      title: "Create account",
      chooseAvatar: "Choose profile photo",
      nameLabel: "Full name",
      nicknameLabel: "Nickname",
      phoneLabel: "Phone number",
      emailLabel: "Email",
      genderLabel: "Gender",
      dobLabel: "Date of birth",
      provinceLabel: "Province / City",
      provincePlaceholder: "-- Select --",
      cccdLabel: "Citizen ID",
      cccdPlaceholder: "12 digits",
      passwordLabel: "Password",
      confirmPasswordLabel: "Confirm password",
      submit: "Create account",
      processing: "Processing...",
      hasAccount: "Already have an account?",
      login: "Log in",
      aria: {
        togglePassword: "Show or hide password",
        toggleConfirmPassword: "Show or hide confirm password",
      },
      genderOptions: {
        unspecified: "--",
        male: "Male",
        female: "Female",
        other: "Other",
      },
      validation: {
        required: "Required",
        empty: "This field cannot be empty",
        minChars: "Minimum {count} characters",
        invalidPhone: "Invalid format (10 digits, starts with 0)",
        invalidEmail: "Invalid email address",
        invalidDob: "Invalid date of birth",
        futureDob: "Date cannot be in the future",
        minDob: "Date cannot be before 01/01/1940",
        invalidGender: "Invalid gender",
        invalidCccd: "Citizen ID must contain 12 digits",
        passwordMismatch: "Passwords do not match",
        avatarRequired: "Please upload a profile photo.",
        avatarTooLarge: "Image must not exceed 10MB",
      },
      success: "Registration successful!",
      errors: {
        failed: "Registration failed",
        avatarUploadFailed: "Avatar upload failed",
        checkInfo: "Please review the information and try again.",
        emailUsed: "This email is already in use",
        phoneUsed: "This phone number is already in use",
        cccdUsed: "This citizen ID is already in use",
        nicknameUsed: "This nickname is already taken",
      },
    },
    forgot: {
      seoTitle: "Forgot password",
      seoDescription: "Recover your Pickletour.vn account password",
      title: "Forgot password",
      intro:
        "Enter the email address you used for your account. We will send you a link to reset your password.",
      emailLabel: "Email",
      submit: "Send instructions",
      backToLogin: "Back to login",
      successToast:
        "Password reset instructions have been sent to your email",
      sentNoticePrefix: "Request sent to:",
      sentNoticeSuffix: "Please check your inbox or spam folder.",
      errors: {
        failed: "Unable to send the request right now. Please try again later.",
      },
    },
    reset: {
      seoTitle: "Reset password",
      seoDescription: "Create a new password for your account",
      title: "Reset password",
      missingToken: "Missing token. Please open the link from your email.",
      newPasswordLabel: "New password",
      confirmPasswordLabel: "Confirm password",
      minLengthHint: "At least 6 characters",
      mismatchShort: "Does not match",
      submit: "Reset password",
      backToLogin: "Back to login",
      success: "Password changed successfully. Please log in again.",
      errors: {
        missingToken: "Missing token. Open the link from your email to continue.",
        mismatch: "Passwords do not match",
        failed:
          "Unable to reset your password. The token may have expired.",
      },
    },
  },
  contact: {
    seoTitle: "Contact",
    seoDescription:
      "Contact Pickletour.vn for tournament operations, rating support, and sports platform services. Reach us by email, phone, or social channels.",
    seoKeywords: "contact, support, pickletour, email, phone",
    title: "Contact information",
    supportRoles: {
      general: "Support",
      scoring: "Rating support",
      sales: "Sales",
    },
  },
  legal: {
    layout: {
      mainSections: "Main sections",
      needMoreHelpTitle: "Need more help?",
      needMoreHelpBody:
        "If you need clarification about a policy or want to submit a data request, contact the PickleTour team.",
      goToContact: "Go to contact",
    },
    cookies: {
      title: "Cookie Policy",
      description:
        "Explains how PickleTour uses cookies and similar technologies to keep sessions stable, measure performance, and personalize your experience when using the platform.",
      eyebrow: "Cookies",
      updatedAt: "15/03/2026",
      highlights: [
        {
          label: "Scope",
          value: "Essential, analytics, and personalization cookies",
        },
        {
          label: "Applies to",
          value: "PickleTour website and related sign-in flows",
        },
        { label: "Updated", value: "15/03/2026" },
      ],
      sections: [
        {
          id: "cookies-overview",
          title: "What cookies are",
          paragraphs: [
            "Cookies are small files stored by your browser to help PickleTour remember your session, interface preferences, and actions you have taken on the website.",
            "We use cookies to keep the site stable, preserve sign-in state, measure performance, and improve tournament pages, profiles, clubs, and live content.",
          ],
        },
        {
          id: "cookies-categories",
          title: "The cookie categories we use",
          items: [
            "Essential cookies: maintain sign-in state, protect access sessions, manage admin permissions, and preserve form state.",
            "Performance and analytics cookies: help us understand which pages are visited most, where loading slows down, and which navigation patterns are common.",
            "Experience preference cookies: remember theme mode, display settings, and other options so you do not need to reconfigure them repeatedly.",
          ],
        },
        {
          id: "cookies-third-party",
          title: "Third-party services",
          paragraphs: [
            "Some third-party tools may place cookies or similar technologies when you use PickleTour, such as performance analytics, incident monitoring, or embedded social content.",
            "Those services are responsible for their own privacy policies. Review each provider's terms if you want details about how they process data.",
          ],
        },
        {
          id: "cookies-manage",
          title: "How you can manage cookies",
          items: [
            "Delete cookies directly in your browser settings.",
            "Block third-party cookies when your browser supports it.",
            "Use private browsing if you do not want history and cookies stored after a session.",
            "Keep in mind that disabling essential cookies may prevent parts of PickleTour from working properly, especially sign-in, profile updates, and tournament management.",
          ],
        },
        {
          id: "cookies-updates",
          title: "Cookie policy updates",
          paragraphs: [
            "This policy may change when PickleTour adds new features, changes measurement tools, or updates legal requirements related to privacy.",
            "When material changes happen, we will update the effective date on this page so you can track them easily.",
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      description:
        "Describes how PickleTour collects, uses, stores, and protects personal data when you create an account, join tournaments, or use platform features.",
      eyebrow: "Privacy",
      updatedAt: "15/03/2026",
      highlights: [
        {
          label: "Data",
          value: "Account, profile, activity, and support information",
        },
        {
          label: "Purpose",
          value: "Run the platform, verify users, and improve the service",
        },
        { label: "Updated", value: "15/03/2026" },
      ],
      sections: [
        {
          id: "privacy-collection",
          title: "Information we collect",
          items: [
            "Account data such as full name, email, phone number, hashed password, and user role.",
            "Profile data such as avatar, date of birth, location, nickname, tournament history, and club participation.",
            "Verification data such as citizen ID number and document images if you voluntarily submit KYC records.",
            "Technical data such as IP address, device, browser, error logs, and basic navigation behavior to maintain security and performance.",
          ],
        },
        {
          id: "privacy-usage",
          title: "How we use your data",
          items: [
            "Provide and maintain user accounts on PickleTour.",
            "Organize, display, and synchronize tournaments, rankings, schedules, and club areas.",
            "Handle support requests, assess security risks, prevent abuse, and verify identity when needed.",
            "Analyze product performance to improve speed, layout, and the overall user experience.",
          ],
        },
        {
          id: "privacy-sharing",
          title: "When data may be shared",
          paragraphs: [
            "PickleTour does not sell your personal data. We only share data when it is necessary to operate the service, comply with law, or protect the platform from abuse.",
            "Sharing may happen with infrastructure providers, analytics tools, incident response vendors, or competent authorities when a lawful request applies.",
          ],
        },
        {
          id: "privacy-storage",
          title: "Data storage and protection",
          paragraphs: [
            "We apply appropriate technical and operational safeguards to reduce the risk of unauthorized access, leakage, or use outside the purposes we have disclosed.",
            "Data is retained only for as long as needed to operate the service, resolve disputes, comply with legal duties, or satisfy internal security requirements.",
          ],
        },
        {
          id: "privacy-rights",
          title: "Your rights",
          items: [
            "Review and update your profile information when the system allows it.",
            "Request support to understand how your data is used.",
            "Request processing or deletion of data where PickleTour can do so without compromising legal duties or system integrity.",
            "Withdraw certain choices related to cookies or optional data at any time.",
          ],
        },
        {
          id: "privacy-contact",
          title: "Privacy contact",
          paragraphs: [
            "If you have questions about privacy, personal data processing, or account-related support, contact PickleTour at support@pickletour.vn.",
            "We will review the request and respond within a reasonable timeframe based on the complexity of the issue.",
          ],
        },
      ],
    },
    terms: {
      title: "Terms of Use",
      description:
        "Defines the rules for using PickleTour, user responsibilities, service limitations, and how the platform handles account, content, and operational matters.",
      eyebrow: "Terms",
      updatedAt: "15/03/2026",
      highlights: [
        {
          label: "Applies to",
          value: "All users, clubs, and admin areas",
        },
        {
          label: "Covers",
          value: "Accounts, platform behavior, and responsibilities",
        },
        { label: "Updated", value: "15/03/2026" },
      ],
      sections: [
        {
          id: "terms-acceptance",
          title: "Acceptance of terms",
          paragraphs: [
            "By accessing or using PickleTour, you agree to the current terms of use on this platform. If you do not agree, you should stop using the service.",
            "These terms apply to the website, user accounts, publicly displayed data, admin areas, and features related to tournaments or community spaces.",
          ],
        },
        {
          id: "terms-account",
          title: "Accounts and submitted information",
          items: [
            "You are responsible for the accuracy of your registration details and profile updates.",
            "You must not share an account in a way that compromises security or creates unauthorized access to the system.",
            "PickleTour may temporarily restrict or suspend certain functions if it detects signs of impersonation, abuse, or security violations.",
          ],
        },
        {
          id: "terms-acceptable-use",
          title: "Permitted and prohibited behavior",
          items: [
            "Do not interfere unlawfully with tournament data, rankings, scores, or other users' information.",
            "Do not upload content that is illegal, abusive, fraudulent, or misleading about events, tournaments, or clubs.",
            "Do not attempt to degrade performance, scan for vulnerabilities, or gain unauthorized access to admin areas or internal APIs.",
          ],
        },
        {
          id: "terms-content",
          title: "Content and ownership",
          paragraphs: [
            "Content you submit to PickleTour remains yours or your organization's where you have proper rights, but you grant PickleTour the rights needed to store, display, and operate that content within the service.",
            "The interface, brand assets, data structure, system content, and platform-generated components belong to PickleTour or its licensed partners.",
          ],
        },
        {
          id: "terms-availability",
          title: "Service availability",
          paragraphs: [
            "We work to keep the service stable, but PickleTour does not guarantee uninterrupted availability at all times, especially during maintenance, infrastructure incidents, or other factors outside our control.",
            "PickleTour may change, upgrade, or pause parts of the service to preserve system safety and the overall experience.",
          ],
        },
        {
          id: "terms-liability",
          title: "Limitation of liability",
          paragraphs: [
            "To the extent permitted by law, PickleTour is not liable for indirect damages arising from the use of, or inability to use, the platform, including data loss, operational interruption, or decisions based on third-party information.",
            "Users and tournament organizers remain ultimately responsible for their own information, rules, decisions, and legal obligations related to their activities.",
          ],
        },
        {
          id: "terms-changes",
          title: "Changes to these terms",
          paragraphs: [
            "PickleTour may update these terms to reflect product changes, operational needs, or legal requirements. The new version will display a clear updated date on this page.",
            "Continuing to use the service after the terms are updated means you accept the revised version.",
          ],
        },
      ],
    },
  },
  errors: {
    forbidden: {
      seoTitle: "403 - Forbidden",
      title: "Access denied",
      description:
        "You do not have permission to view this page. Sign in with an admin account or go back to the previous page.",
      login: "Log in",
    },
    serviceUnavailable: {
      seoTitle: "503 - Service temporarily unavailable",
      title: "Service temporarily unavailable",
      description:
        "The server is busy or the system is under maintenance. Please try again in a few minutes. We are sorry for the inconvenience.",
      autoRetry: "Trying again in",
      retryNow: "Retry now",
    },
    notFound: {
      seoTitle: "404 - Content not found",
      title: "Content not found",
      description:
        "The resource you requested does not exist, has been removed, or the URL is invalid.",
      originLabel: "Original URL:",
    },
  },
  home: {
    seoDescription:
      "Pickletour.vn - A platform for sports communities, tournament operations, rating tracking, and pickleball rankings in Vietnam.",
    seoKeywords:
      "pickleball, tournaments, rankings, rating, sports, community",
    heroFallback: {
      title: "Connect the community and manage sports tournaments",
      lead:
        "PickleTour helps you register, organize, track ratings, and keep standings up to date for every sport right from your phone.",
      imageAlt: "PickleTour - Community and tournament management platform",
    },
    hero: {
      badge: "Reinventing Pickleball in Vietnam",
    },
    actions: {
      getStarted: "Get started",
      login: "Log in",
      selfAssess: "Self-assess",
      verifyIdentity: "Verify identity",
      exploreTournaments: "Explore tournaments",
    },
    stats: {
      eyebrow: "Numbers that matter",
      title: "A growing community",
      cards: {
        players: "Players",
        tournaments: "Tournaments",
        matches: "Matches",
        clubs: "Pickleball clubs",
      },
    },
    features: {
      eyebrow: "Key features",
      title: "Everything you need, one platform",
      description:
        "From tournament operations to rating tracking, PickleTour gives every player the tools they need.",
      items: [
        {
          title: "DUPR-style rating system",
          desc:
            "Track player ratings with an international-style standard that updates after every official match.",
        },
        {
          title: "Tournament operations",
          desc:
            "Create and run tournaments with automated groups, brackets, and live result updates.",
        },
        {
          title: "Profiles and analytics",
          desc:
            "Review match history, form, win rate, and long-term progress in one place.",
        },
        {
          title: "Active community",
          desc:
            "Connect with thousands of players and find opponents near your skill level.",
        },
        {
          title: "Mobile experience",
          desc:
            "Enjoy a smooth experience across iOS and Android with updates wherever you are.",
        },
        {
          title: "Smart notifications",
          desc:
            "Get reminders for upcoming tournaments, match results, and rating updates.",
        },
      ],
    },
    clubs: {
      eyebrow: "Partners and clubs",
      title: "Trusted by leading clubs",
      description:
        "Hundreds of pickleball clubs across Vietnam already use PickleTour to manage events and track ratings.",
      members: "{count} members",
    },
    cta: {
      title: "Ready to level up your Pickleball experience?",
      description:
        "Join thousands of players on PickleTour. Sign up for free and start your journey today.",
      guestButton: "Create a free account",
      memberButton: "Explore tournaments",
    },
    contactCards: {
      headquartersTitle: "Head office",
      supportTitle: "Support channels",
      socialTitle: "Social channels",
      appDownloadsTitle: "Download the app",
      supportRoles: {
        general: "General",
        scoring: "Rating",
        partnership: "Partnerships",
      },
      directApk: "Direct APK downloads:",
      userApp: "Player app",
      refereeApp: "Referee app",
    },
  },
  chatbot: {
    title: "Pikora",
    subtitle: "PickleTour virtual assistant",
    processing: "Processing...",
    settingsTitle: "Settings",
    settingsSubtitle: "Assistant preferences",
    settingsTooltip: "Settings",
    closeTooltip: "Close",
    welcomeTitle: "Hello{name}!",
    welcomeBody:
      "I'm Pikora, the PickleTour virtual assistant. Ask me anything about tournaments, ratings, or players.",
    historyLoadedAll: "— Full history loaded —",
    inputPlaceholder: "Type a message...",
    navigationOpen: "Open page",
    suggestions: {
      guest: [
        "What is pickleball?",
        "How do I create an account?",
        "Upcoming tournaments?",
        "How do I register for an event?",
      ],
      member: [
        "What is my rating?",
        "Which events did I join?",
        "Show my match stats",
        "Upcoming tournaments?",
      ],
    },
    thinking: {
      active: "Processing...",
      done: "Done",
      doneWithDuration: "Done in {seconds}s",
    },
    settings: {
      memoryTitle: "Conversation memory",
      sessionMessageCount: "{count} messages in this session",
      clearHistory: "Clear chat history",
      botInfoTitle: "Bot info",
      botNameLabel: "Name",
      botNameValue: "Pikora",
      capabilitiesLabel: "Capabilities",
      capabilitiesValue:
        "Find events, rankings, player stats, and app guidance",
      tipsTitle: "Usage tips",
      tips: [
        "Ask specific questions for more accurate answers",
        "Say “mine” to view personal information",
        "Clear history if the bot starts drifting off topic",
      ],
      learningTitle: "Auto-learn",
      learningBody:
        "The bot learns from successful questions to answer faster over time.",
      clearLearning: "Clear learning memory",
      clearLearningSuccess: "Cleared {count} learned items",
      clearLearningError: "Unable to clear learning memory",
    },
    confirmClearTitle: "Clear chat history?",
    confirmClearBody:
      "All messages will be deleted and cannot be restored. Are you sure you want to continue?",
    errors: {
      generic: "Something went wrong",
      genericRetry: "Something went wrong. Please try again.",
      rateLimit:
        "You have reached the question limit for this session. Please try again later.",
    },
  },
  admin: {
    layout: {
      seoTitle: "System administration",
      title: "Admin",
      subtitle: "Control panel",
      users: "User management",
      news: "News management",
      backHome: "Back to home",
      navAria: "Admin navigation",
    },
  },
  facebookLive: {
    seoTitle: "Facebook Live settings",
    title: "Facebook Live",
    subtitle:
      "Connect Facebook to stream live matches directly to your page.",
    connect: "Connect Facebook",
    connecting: "Opening Facebook...",
    infoAlert:
      "After clicking “Connect Facebook”, the system will open Facebook so you can grant access. Once accepted, return to this page and the page list will refresh automatically.",
    connectedPagesTitle: "Connected pages",
    connectedPagesSubtitle:
      "Choose one page as the default destination for match livestreams.",
    loadingPages: "Loading page list...",
    loadError: "Unable to load the page list. Please try again later.",
    empty:
      "No page is connected yet. Click “Connect Facebook” to get started.",
    defaultPageTooltip: "This is the default page",
    setDefaultTooltip: "Set as default page",
    deleteTooltip: "Remove this page connection",
    defaultBadge: "Default",
    connectError:
      "Unable to get the Facebook connection link. Please try again.",
    setDefaultError:
      "Unable to set the default page. Please try again.",
    deleteConfirm:
      "Are you sure you want to remove this fanpage connection from your account?",
    deleteError: "Unable to remove the connection. Please try again.",
    matchUsage:
      "When creating a live stream for a match, the backend will prefer your default fanpage. If none is set, it will fall back to the shared page pool.",
  },
  live: {
    matches: {
      seoTitle: "Live",
      seoDescription:
        "Watch live scores, video, and match activity from pickleball events happening across Vietnam.",
      filterTitle: "Filters",
      statusTitle: "Status",
      timeWindowTitle: "Time window",
      autoRefreshTitle: "Auto refresh",
      all: "All",
      recentHours: "Last {count} hours",
      recentDays: "Last {count} days",
      excludingFinished: "Finished matches excluded",
      includingFinished: "Finished matches included",
      enable: "Enabled",
      seconds: "{count}s",
      searchPlaceholder: "Search match code, court, platform…",
      filterButton: "Filters",
      refreshTooltip: "Refresh",
      statusChip: "Status: {value}",
      windowChip: "Window: {value}h",
      finishedChip: "Finished excluded",
      autoChip: "Auto: {value}",
      streamCountUpdated: "{count} live feeds • updated {seconds}s ago",
      timeRangeLabel: "Time range: {value}",
      today: "today",
      emptyTitle: "No matches match the current filters",
      emptyBody:
        "Try opening “Filters”, choosing “LIVE”, or increasing the time window.",
    },
  },
  clubs: {
    list: {
      seoTitle: "Clubs",
      seoDescription:
        "Join pickleball clubs, connect with the community, create groups, and play friendly events.",
      seoKeywords:
        "pickleball clubs, club community, join club, create club",
      heroTitle: "Community & Clubs",
      heroSubtitle: "Connect, meet players, and join exciting tournaments",
      createClub: "Create new club",
      searchPlaceholder: "Search clubs...",
      allSports: "All sports",
      provincePlaceholder: "Province / City",
      discoverTab: "Explore",
      myClubsTab: "My clubs",
      loginRequired: "You need to log in to see your clubs.",
      loginToViewMinePrefix: "Please",
      loginToViewMineAction: "log in",
      loginToViewMineSuffix: "to view the clubs you have joined.",
      emptyMineTitle: "You have not joined any club yet",
      emptyMineBody:
        "Start by creating your own club or explore clubs that are already active.",
      createNow: "Create a club now",
      noSearchTitle: "No results found",
      noSearchBody: "No club matches the current keyword or filters.",
      clearFilters: "Clear search filters",
      emptyTitle: "No clubs yet",
      emptyBody: "There are no clubs in the system yet.",
      createFirst: "Create the first club",
      createSuccess: "Club created successfully!",
      genericError: "Something went wrong. Please try again.",
    },
    detail: {
      memberGuardAdmins:
        "The member list is only visible to club administrators.",
      memberGuardMembers:
        "The member list is only visible to club members.",
      memberGuardUnavailable:
        "The member list is currently unavailable.",
      actionsTitle: "Actions",
      manageTitle: "Club management",
      editClub: "Edit club",
      reviewJoinRequests: "Review join requests",
      notFound: "Club not found",
      descriptionFallback:
        "Pickleball club {name} - Join the community and play together!",
      memberFallback: "Member",
      breadcrumbHome: "Home",
      breadcrumbClubs: "Club directory",
      breadcrumbDetail: "Club details",
      tabs: {
        news: "Feed",
        events: "Events",
        polls: "Polls",
      },
      sections: {
        news: "Feed",
        members: "Club members",
        events: "Events",
        polls: "Polls",
      },
      saveSuccess: "Club saved successfully!",
    },
  },
  tournaments: {
    statuses: {
      upcoming: "Upcoming",
      ongoing: "In progress",
      finished: "Finished",
    },
    actions: {
      register: "Register",
      schedule: "Schedule",
      bracket: "Bracket",
      viewResults: "View results bracket",
    },
    dashboard: {
      seoTitle: "Tournaments",
      seoDescription:
        "Explore and register for pickleball tournaments across Vietnam. View schedules, results, and brackets.",
      seoKeywords:
        "pickleball tournaments, event registration, tournament schedule, tournament results",
      title: "Tournaments",
      subtitle: "Manage and join professional sports events.",
      totalCount: "TOTAL EVENTS",
      ongoingCount: "LIVE NOW",
      upcomingCount: "COMING UP",
      searchPlaceholder: "Search tournament name...",
      datePlaceholder: "Filter by date",
      loadError: "Unable to load data: {message}",
      empty: "No tournament matches the current filters.",
      locationFallback: "Not updated",
      registeredTeams: "Registered teams",
    },
  },
  myTournaments: {
    title: "My tournaments",
    loginTitle: "Log in to view My tournaments",
    loginBody:
      "After logging in, you will see the events you joined, your match schedule, and personal results.",
    searchPlaceholder: "Search tournaments (name, location)",
    matchSearchPlaceholder: "Search matches (player, round, court...)",
    listMode: "List mode",
    cardMode: "Card mode",
    matchingCount: "{count} matching tournaments",
    loadError: "Unable to load data. Please try again.",
    emptyTitle: "No tournaments yet",
    emptyBody:
      "Join a tournament to track your schedule and results here.",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    noScheduledMatches: "No match has been scheduled yet.",
    noFilteredMatches: "No match matches the current filters.",
    viewAllMatches: "View all {count} matches",
    collapseList: "Collapse list",
    collapse: "Collapse",
    expandDetails: "Expand details",
    tournamentFallback: "Tournament",
    unknownLocation: "Location not available",
    court: "Court {name}",
    reset: "Reset",
    rounds: {
      group: "Group stage",
      groupName: "Group {name}",
      groupRound: "Group stage - Round {round}",
      swissRound: "Swiss - Round {round}",
      roundOf16: "Round of 16",
      roundOf8: "Round of 8",
      quarterfinal: "Quarterfinal",
      semifinal: "Semifinal",
      final: "Final",
      round: "Round {round}",
    },
  },
  installBanner: {
    title: "A better experience on the app",
    subtitle: "Notifications, ratings, and instant updates.",
  },
};
