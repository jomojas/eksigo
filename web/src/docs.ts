// The privacy policy, terms of use and support page, in English and Chinese. Other languages show the English.
// Text may hold [links](url); e-mail addresses become links by themselves.
// Keep the privacy policy in step with the apps (docs/DESIGN.md, "Privacy policy facts").

export type Doc = {
  title: string;
  updated?: string;
  intro: string;
  sections: { h: string; p: (string | string[])[] }[];
};

export type DocName = "privacy" | "terms" | "support";

const privacyEn: Doc = {
  title: "Privacy policy",
  updated: "Last updated: 18 November 2026",
  intro:
    "In short: Eksigo runs on your computer and your phone. Your audio, transcripts and practice stay on your devices. An account is optional and only used to sync. No ads, no tracking, no data sold.",
  sections: [
    {
      h: "1. What stays on your devices",
      p: [
        "Downloaded episodes, your own audio and video files, transcripts, your dictation answers and results, My words, listening history and settings are stored on your computer or iPhone. Transcription runs on your computer. We can't see any of it. Removing the app and its data removes it.",
      ],
    },
    {
      h: "2. Accounts are optional",
      p: [
        "You can use Eksigo without an account. To sync between your computer and your iPhone, you can sign in with Apple or Google. We then receive:",
        ["Apple's or Google's identifier for you (a number with no personal details in it);", "your e-mail address and name. With Apple you can choose not to share them."],
        "We use them only to recognise your account. We don't send marketing e-mail. On the computer, your sign-in is kept in the macOS Keychain or the Windows Credential Manager.",
      ],
    },
    {
      h: "3. What syncs",
      p: [
        "With an account, our server (api.eksigo.com) keeps your listening history, saved words, missed sentences as text with their times, and practice summaries, so both apps can show them. No audio is ever synced.",
      ],
    },
    {
      h: "4. AI",
      p: [
        "AI features are optional. When you ask the AI, the desktop app sends what the question is about (the sentence, what you typed and the sentences around it, or a word and its sentence) straight to the provider you chose:",
        ["OpenAI, when you sign in with ChatGPT;", "the provider of your own API key, such as OpenAI, Anthropic, DeepSeek or Groq."],
        "Our server never sees these requests or your key. Your key is kept in the macOS Keychain or the Windows Credential Manager. The provider handles your requests under its own terms.",
      ],
    },
    {
      h: "5. What the apps download",
      p: [
        "Podcast audio and artwork come straight from their publishers' servers, which see your IP address, as with any podcast app. Searching uses Apple's public podcast directory. The speech model and phrase translator come from Hugging Face (or its mirror, hf-mirror.com), dictionaries from our server, and desktop updates from GitHub. None of these requests include your account.",
      ],
    },
    {
      h: "6. Server logs",
      p: ["To prevent abuse and fix problems, our server keeps short-lived request logs (time, request and IP address). They contain no audio and nothing you typed."],
    },
    {
      h: "7. What we don't do",
      p: [
        [
          "No ads and no advertising identifiers;",
          "no tracking across apps or websites;",
          "no selling or renting of personal data;",
          "no third-party analytics. This website sets no cookies; it only remembers your language in your browser.",
        ],
      ],
    },
    {
      h: "8. Deleting your account",
      p: [
        "In the desktop app, go to Settings › Account › Delete account; in the iPhone app, the Me tab › Delete account. This deletes your account and everything synced to our server right away.",
      ],
    },
    {
      h: "9. Children",
      p: ["Eksigo isn't directed at children under 13, and we don't knowingly collect their personal information."],
    },
    {
      h: "10. Changes and contact",
      p: ["If this policy changes in an important way, we'll say so here and in the apps. Questions: support@eksigo.com."],
    },
  ],
};

const privacyZh: Doc = {
  title: "隐私政策",
  updated: "更新日期：2026 年 11 月 18 日",
  intro: "简单来说：Eksigo 在你的电脑和手机上运行。你的音频、文字稿和练习记录都保存在你的设备上。账户是可选的，只用于同步。我们不投放广告，不追踪你，也不出售任何数据。",
  sections: [
    {
      h: "1. 保存在你设备上的数据",
      p: ["下载的节目、你自己的音频和视频文件、文字稿、听写的答案和结果、我的生词、收听记录和设置，都保存在你的电脑或 iPhone 上。转写在你的电脑上完成。我们看不到这些内容。删除 App 及其数据即可全部删除。"],
    },
    {
      h: "2. 账户是可选的",
      p: [
        "不登录也能使用 Eksigo。如果想在电脑和 iPhone 之间同步，可以用 Apple 或 Google 登录。登录时我们会收到：",
        ["Apple 或 Google 提供的用户标识（一串不含个人信息的编号）；", "你的电子邮箱和姓名。使用 Apple 登录时可以选择不分享。"],
        "我们只用它们识别你的账户，不会发送营销邮件。在电脑上，登录信息保存在 macOS 钥匙串或 Windows 凭据管理器中。",
      ],
    },
    {
      h: "3. 同步的内容",
      p: ["登录后，我们的服务器（api.eksigo.com）会保存你的收听记录、生词、漏听的句子（文字和时间）以及练习汇总，让两个 App 都能看到。音频永远不会同步。"],
    },
    {
      h: "4. AI",
      p: [
        "AI 功能是可选的。你向 AI 提问时，桌面 App 会把问题相关的内容（这句话、你打的内容和前后几句，或一个词和它所在的句子）直接发送给你选择的服务商：",
        ["使用 ChatGPT 登录时，发送给 OpenAI；", "使用你自己的 API 密钥时，发送给该密钥的服务商，例如 OpenAI、Anthropic、DeepSeek 或 Groq。"],
        "我们的服务器看不到这些请求，也看不到你的密钥。密钥保存在 macOS 钥匙串或 Windows 凭据管理器中。服务商按照各自的条款处理你的请求。",
      ],
    },
    {
      h: "5. App 会下载的内容",
      p: ["播客的音频和封面直接从发布方的服务器下载，这些服务器可以看到你的 IP 地址，和其他播客 App 一样。搜索播客使用 Apple 的公开播客目录。语音模型和短语翻译器从 Hugging Face（或其镜像 hf-mirror.com）下载，词典从我们的服务器下载，桌面版的更新从 GitHub 下载。这些请求都不包含你的账户。"],
    },
    {
      h: "6. 服务器日志",
      p: ["为了防止滥用和排查故障，我们的服务器会短期保留请求日志（时间、请求内容和 IP 地址），其中不包含音频，也不包含你打的内容。"],
    },
    {
      h: "7. 我们不做的事",
      p: [["不投放广告，不使用广告标识符；", "不跨 App 或网站追踪你；", "不出售、不出租任何个人数据；", "不使用第三方统计。本网站不设置 Cookie，只在你的浏览器里记住你选择的语言。"]],
    },
    {
      h: "8. 删除账户",
      p: ["在桌面 App 中，前往「设置 › 账户 › 删除账户」；在 iPhone App 中，前往「我的 › 删除账户」。删除后，你的账户和所有同步到我们服务器的数据会立即删除。"],
    },
    {
      h: "9. 儿童",
      p: ["Eksigo 不面向 13 岁以下的儿童，我们不会有意收集儿童的个人信息。"],
    },
    {
      h: "10. 变更与联系",
      p: ["本政策如有重要变更，我们会在本页面和 App 内告知。有任何问题，请发邮件至 support@eksigo.com。"],
    },
  ],
};

const termsEn: Doc = {
  title: "Terms of use",
  updated: "Last updated: 18 November 2026",
  intro: "Welcome to Eksigo. By using the apps you agree to these terms.",
  sections: [
    {
      h: "1. The apps",
      p: [
        "Eksigo is English listening practice for Mac, Windows and iPhone. The apps are free. Their source code is open under the GNU Affero General Public License 3.0, on GitHub. Podcasts are made by their publishers; Eksigo is not affiliated with them and isn't responsible for their content.",
      ],
    },
    { h: "2. Your audio", p: ["Only add audio and video you have the right to use. Files you add stay on your computer."] },
    { h: "3. Accounts", p: ["An account is optional and used for sync. Keep your sign-in to yourself."] },
    {
      h: "4. AI",
      p: [
        "AI answers are generated automatically and can be wrong: use them as a learning aid, not an authority. When you use ChatGPT or your own API key, that provider's terms and charges apply. We don't charge for it.",
      ],
    },
    {
      h: "5. Fair use",
      p: ["Eksigo is for personal learning. Please don't:", ["scrape or overload our server, or access it with automated tools;", "use Eksigo to break anyone else's rights."], "We may suspend accounts that break these rules."],
    },
    { h: "6. Changes", p: ["We keep improving Eksigo and may add, change or remove features."] },
    {
      h: "7. Disclaimer",
      p: [
        "Eksigo is provided \"as is\". As far as the law allows, we don't guarantee it will be uninterrupted or error-free, and we're not liable for indirect losses from using it. The source code also comes with the licence's own disclaimer.",
      ],
    },
    { h: "8. Contact", p: ["Questions about these terms: support@eksigo.com."] },
  ],
};

const termsZh: Doc = {
  title: "使用条款",
  updated: "更新日期：2026 年 11 月 18 日",
  intro: "欢迎使用 Eksigo。使用本 App 即表示你同意以下条款。",
  sections: [
    {
      h: "1. 关于 App",
      p: ["Eksigo 是用于 Mac、Windows 和 iPhone 的英语听力练习 App，免费使用。源代码以 GNU Affero 通用公共许可证 3.0 在 GitHub 上开源。播客由各自的发布方制作，Eksigo 与发布方没有关联，也不对节目内容负责。"],
    },
    { h: "2. 你的音频", p: ["请只添加你有权使用的音频和视频。你添加的文件会留在你的电脑上。"] },
    { h: "3. 账户", p: ["账户是可选的，用于同步。请勿与他人共用。"] },
    { h: "4. AI", p: ["AI 的回答由程序自动生成，可能有错，请把它当作学习辅助，而不是权威参考。使用 ChatGPT 或你自己的 API 密钥时，适用该服务商的条款和收费，我们不收取任何费用。"] },
    { h: "5. 合理使用", p: ["Eksigo 仅供个人学习使用。请勿：", ["抓取或过度请求我们的服务器，或用自动化程序访问它；", "用 Eksigo 侵犯他人的权利。"], "违反这些规则时，我们可能暂停相关账户。"] },
    { h: "6. 变更", p: ["我们会不断改进 Eksigo，可能增加、修改或停止部分功能。"] },
    { h: "7. 免责声明", p: ["Eksigo 按“现状”提供。在法律允许的范围内，我们不保证服务不中断或没有错误，也不对因使用造成的间接损失负责。源代码另适用其许可证中的免责声明。"] },
    { h: "8. 联系我们", p: ["对这些条款有任何疑问，请发邮件至 support@eksigo.com。"] },
  ],
};

const supportEn: Doc = {
  title: "Support",
  intro: "A problem or an idea? We'd like to hear it.",
  sections: [
    {
      h: "Contact us",
      p: [
        "E-mail support@eksigo.com, in English or Chinese. We usually reply within two working days. For a problem, please say whether you're on Mac, Windows or iPhone, which version of Eksigo (Settings › About), and what you were doing.",
        "You can also report a bug on [GitHub](https://github.com/jomojas/eksigo/issues).",
      ],
    },
    {
      h: "Windows says it protected my PC",
      p: ["The installer isn't signed yet, which is common for new apps. Choose More info, then Run anyway."],
    },
    {
      h: "How do I update?",
      p: ["The desktop app checks for new versions by itself and tells you when one is ready to install."],
    },
    {
      h: "How do I delete my account?",
      p: ["See section 8 of the [privacy policy](/privacy.html)."],
    },
  ],
};

const supportZh: Doc = {
  title: "帮助与联系",
  intro: "遇到问题或有建议？我们很乐意听到。",
  sections: [
    {
      h: "联系我们",
      p: [
        "发邮件至 support@eksigo.com，中文或英文都可以。我们通常在两个工作日内回复。如果是 App 出错，请说明你用的是 Mac、Windows 还是 iPhone，Eksigo 的版本（设置 › 关于），以及当时在做什么。",
        "你也可以在 [GitHub](https://github.com/jomojas/eksigo/issues) 上报告问题。",
      ],
    },
    { h: "Windows 提示“已保护你的电脑”", p: ["安装包还没有签名，新软件常会这样。点「更多信息」，再点「仍要运行」即可。"] },
    { h: "怎么更新？", p: ["桌面 App 会自动检查新版本，准备好后会提示你安装。"] },
    { h: "怎么删除账户？", p: ["见[隐私政策](/privacy.html)第 8 条。"] },
  ],
};

export const DOCS: Record<DocName, { en: Doc; zh: Doc }> = {
  privacy: { en: privacyEn, zh: privacyZh },
  terms: { en: termsEn, zh: termsZh },
  support: { en: supportEn, zh: supportZh },
};
