以下のアプリに、Microsoftログイン機能を追加・修正してください。

対象アプリ:
C:\Users\太宰府2\src\Work\【対象アプリのフォルダ名】

参考実装:
C:\Users\太宰府2\src\Work\business-summary-table

参考にする過去案件:

* business-summary-table
* Overall-Project-Schedule-48
* earned-value-dashboard-48

ただし、過去案件の実装をそのままコピーするのではなく、今回の重要方針に合わせて修正してください。

# 重要な前提

このアプリは、単体で直接URLを開く場合もありますが、本番では n-app-portal / app-portal 側のポータルサイト内に iframe として埋め込まれて動作します。

そのため、iframe 内で Microsoft の ssoSilent / loginPopup / loginRedirect / acquireTokenSilent を直接動かす実装は避けてください。

サードパーティ iframe 環境では、ブラウザ制約により、MSAL の非表示 iframe や popup 連携が不安定になりやすいです。

今回の最重要方針は以下です。

* iframe内では、子アプリ自身でMicrosoftログインを実行しない
* iframe内では、親ポータルから postMessage でログイン済み情報を受け取る
* iframe外で直接アクセスされた場合だけ、通常のMSAL認証を行う
* iframe内で白画面、無限ループ、ポップアップ停止が起きないようにする
* 人間側で必要な Microsoft Entra 管理センター等の設定作業は、コード修正AIが実施したことにせず、最後にチャットで人間へ別途伝える

# 今回の Overall-Project-Schedule-48 で分かった重要な原因

以前の実装では、子アプリが REQUEST_AUTH_INFO / AUTH_INFO という独自メッセージ名を使っていました。

しかし実際の app-portal は AUTH_HINT_REQUEST / AUTH_HINT に対応していたため、親子間の認証メッセージ名が一致していませんでした。

また、iframe内でも MSAL の AuthenticatedTemplate に依存していたため、親ポータルで認証済みでも子アプリ側では未認証扱いになっていました。

この2点を避けることが最重要です。

# 実装方針

## 1. iframe 内で表示されている場合

iframe 内で表示されている場合は、子アプリ側から親ポータルへ postMessage で以下を送信してください。

```ts
{ type: "AUTH_HINT_REQUEST" }
```

親ポータルから以下の形式のメッセージを受け取ったら、認証済みとしてアプリ本体を表示してください。

```ts
{ type: "AUTH_HINT", loginHint: "...", name: "..." }
```

このとき、子アプリ側では以下を実行しないでください。

* ssoSilent
* loginPopup
* loginRedirect
* acquireTokenSilent

iframe内では、MSALの accounts が空でも、親ポータルから AUTH_HINT を受け取れればアプリ本体を表示してください。

business-summary-table の AuthWrapper.tsx と同じ考え方で実装してください。

## 2. iframe 外で直接アクセスされた場合

iframe外で直接アクセスされた場合だけ、通常のMSAL認証を使ってください。

直接アクセス時の方針は以下です。

* 既存アカウントがあれば activeAccount に設定する
* アカウントがなければ ssoSilent を試す
* ssoSilent が失敗したら Microsoftログインボタンを表示する
* ログインボタン押下時は loginRedirect を使う
* loginPopup は使わない

popup は iframe環境やブラウザ制約で不安定になりやすいため、今回の実装では使用しないでください。

## 3. public/redirect.html の作成

ssoSilent 用に、アプリ本体ではなく軽量なHTMLを使ってください。

public/redirect.html がなければ作成してください。

内容は以下のような最小HTMLで構いません。

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body></body>
</html>
```

このファイルは ssoSilent 専用です。

React / Next.js / Vite / MSAL本体の処理を読み込まない軽量ページにしてください。

## 4. ssoSilent の redirectUri

ssoSilent のオプションには、以下のように redirect.html を指定してください。

```ts
redirectUri:
  typeof window !== "undefined"
    ? `${window.location.origin}/redirect.html`
    : undefined
```

目的は、ssoSilent がアプリ本体を読み込んで無限ループすることを避けるためです。

## 5. loginRedirect の redirectUri

loginRedirect のリダイレクト先は、アプリ本体のルートURLのままにしてください。

loginRedirect に /redirect.html を指定しないでください。

理由は、直接アクセス時のログイン完了後には、アプリ本体へ戻る必要があるためです。

## 6. loginPopup について

今回の実装では loginPopup は使わないでください。

過去の別アプリでは loginPopup を使う指示がありましたが、今回の方針では採用しません。

理由は、iframe内や本番環境でポップアップが真っ白になって止まる、またはブラウザ制約で不安定になることがあるためです。

## 7. MSAL の初期化と handleRedirectPromise

MSALの初期化部分を確認してください。

AuthProvider / AuthWrapper / authConfig / msalInstance などで new PublicClientApplication() を行っている箇所があれば、以下を確認してください。

* pca.initialize() が必要な構成か
* handleRedirectPromise() を手動で呼ぶ必要がある構成か
* @azure/msal-react の MsalProvider 側で処理している構成か

手動で処理している場合は、initialize の後に handleRedirectPromise を呼んでください。

例:

```ts
await pca.initialize();
await pca.handleRedirectPromise().catch(console.error);
```

ただし、@azure/msal-react のバージョンや既存実装によって、MsalProvider が initialize / handleRedirectPromise を処理している場合があります。

その場合は二重処理にならないよう注意してください。

重要なのは、loginRedirect 後にURLへ付与された認証コードが正しく処理されることです。

これが処理されないと、ログイン後に画面が止まる、ログイン状態にならない、白画面になる可能性があります。

## 8. UIの出し分け

アプリ本体側を AuthenticatedTemplate / UnauthenticatedTemplate に強く依存させないでください。

特に iframe 内では、MSAL の accounts が空でも、親ポータルから AUTH_HINT を受け取れればアプリ本体を表示する必要があります。

認証判定は AuthProvider / AuthWrapper のような上位コンポーネントに集約してください。

推奨する認証状態の考え方は以下です。

```ts
type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; source: "portal"; loginHint: string; name?: string }
  | { status: "authenticated"; source: "msal"; account: AccountInfo }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };
```

iframe内:

* AUTH_HINT を受け取ったら authenticated
* AUTH_HINT が返らない場合は、白画面にせずエラー表示

iframe外:

* MSALアカウントがあれば authenticated
* ssoSilent 成功で authenticated
* 失敗時はログインボタン表示

## 9. iframe判定

iframe内かどうかは、以下のような考え方で判定してください。

```ts
const isInIframe = window.self !== window.top;
```

SSRやビルド時に window が存在しない場合があるため、typeof window !== "undefined" を考慮してください。

## 10. postMessage のセキュリティ

message event では、可能な範囲で送信元を検証してください。

確認すること:

* event.source が window.parent であること
* event.data?.type === "AUTH_HINT" であること
* loginHint が空でないこと
* 可能であれば event.origin が許可された親ポータルのoriginであること

document.referrer から親 origin を取得できる場合は利用してください。

ただし document.referrer が空になるケースもあるため、可能であれば環境変数などで ALLOWED_PARENT_ORIGINS を持たせることも検討してください。

受け取るメッセージは、以下の条件を満たす場合のみ認証済み扱いにしてください。

```ts
event.data?.type === "AUTH_HINT"
event.data?.loginHint が空でない
event.source === window.parent
```

## 11. AUTH_HINT の扱い

AUTH_HINT は「親ポータルでログイン済みであることを子アプリに伝えるためのヒント」として扱ってください。

loginHint や name はアクセストークンではありません。

AUTH_HINT を Microsoft Graph や保護されたAPIを呼び出すためのトークンとして扱わないでください。

子アプリが機密データや保護APIを直接扱う場合は、最終的なアクセス制御は以下のいずれかで行ってください。

* 親ポータル側
* バックエンド側
* API側の認可処理

AUTH_HINT だけでサーバー側の権限を完全に保証した扱いにしないでください。

## 12. 親ポータル側との整合確認

子アプリだけでなく、n-app-portal / app-portal 側が以下に対応しているか確認してください。

* 子アプリからの AUTH_HINT_REQUEST を受け取る
* 親ポータルのログイン情報をもとに AUTH_HINT を返す
* 子アプリへ postMessage で返す
* message type が子アプリと一致している

親ポータル側が未対応の場合は、子アプリ側だけでMSALを動かして解決しようとしないでください。

必要であれば、親ポータル側の postMessage 実装も修正対象にしてください。

## 13. iframe内でAUTH_HINTが返ってこない場合

iframe内で AUTH_HINT_REQUEST を送っても AUTH_HINT が返ってこない場合は、白画面にしないでください。

一定時間後に、以下のような分かりやすいエラー画面を表示してください。

例:

「ポータルから認証情報を取得できませんでした。ポータル側でログイン済みか確認してください。」

または

「このアプリはポータル内での表示を前提としています。ポータルから開いてください。」

## 14. 環境変数

対象アプリのフレームワークに合わせて、環境変数名を確認してください。

Next.js の場合:

```env
NEXT_PUBLIC_MSAL_CLIENT_ID=
NEXT_PUBLIC_MSAL_TENANT_ID=
```

Vite / React の場合:

```env
VITE_MSAL_CLIENT_ID=
VITE_MSAL_TENANT_ID=
```

package.json や既存実装を確認し、Next.js か Vite かを判断してください。

環境変数が未設定の場合は、分かりやすいエラー画面を表示してください。

例:

「Microsoftログイン設定が不足しています。CLIENT_ID または TENANT_ID が未設定です。」

## 15. MSAL設定

MSAL設定では、clientId と tenantId を環境変数から取得してください。

authority は以下の形式を基本としてください。

```ts
authority: `https://login.microsoftonline.com/${tenantId}`
```

cache は既存実装に合わせてください。

必要に応じて以下を検討してください。

```ts
cacheLocation: "localStorage"
storeAuthStateInCookie: false
```

ただし、既存アプリの方針がある場合はそちらを優先してください。

## 16. iframe内での禁止事項

iframe内では以下を実行しないでください。

* loginPopup
* loginRedirect
* ssoSilent
* acquireTokenSilent
* handleRedirectPromise を起点にしたログイン誘導
* allowRedirectInIframe: true による無理なiframe内ログイン

allowRedirectInIframe: true によって iframe 内ログインを無理に有効化しないでください。

今回の方針は、iframe内では親ポータルの認証情報を利用することです。

## 17. React StrictMode / useEffect の多重実行対策

React StrictMode 等により useEffect が複数回実行されても、以下が無限に繰り返されないようにガードしてください。

* AUTH_HINT_REQUEST の送信
* ssoSilent
* loginRedirect
* MSAL初期化
* handleRedirectPromise

useRef などを使い、初回のみ実行する処理は多重実行されないようにしてください。

## 18. 既存ファイルへの影響最小化

既存のUI、集計ロジック、API呼び出し、ルーティングはできるだけ変更しないでください。

認証処理は以下のようなファイルに閉じ込めてください。

* AuthProvider.tsx
* AuthWrapper.tsx
* authConfig.ts
* msalInstance.ts
* public/redirect.html

変更後に git diff を確認し、Microsoft認証と無関係な差分があれば戻してください。

未関係ファイルや未追跡ファイルは触らないでください。

# コード修正AIが実施してよい作業

コード修正AIが実施してよい作業は以下です。

* 認証関連ファイルの追加・修正
* public/redirect.html の作成
* iframe内認証と直接アクセス時認証の分岐実装
* postMessage のメッセージ名統一
* build確認
* 差分確認
* 必要に応じたコミットとプッシュ

# コード修正AIが実施したことにしてはいけない作業

以下は人間側、または管理者権限を持つ担当者が行う作業です。

コード修正AIは、これらを「完了した」とは書かないでください。

* Microsoft Entra 管理センターでのリダイレクトURI登録
* Microsoft Azure ポータルでのアプリ登録設定変更
* Netlify本番環境での環境変数登録・変更
* Microsoft 365 / Entra ID 管理者権限が必要な作業

コード修正AIは、これらの作業が必要な場合、最後に「人間にチャットで伝える内容」として分かりやすく案内してください。

# Netlify側で必要な確認

Netlify側にも、対象アプリで必要な環境変数が設定されているか確認が必要です。

Next.js の場合:

```env
NEXT_PUBLIC_MSAL_CLIENT_ID
NEXT_PUBLIC_MSAL_TENANT_ID
```

Vite / React の場合:

```env
VITE_MSAL_CLIENT_ID
VITE_MSAL_TENANT_ID
```

Netlifyに環境変数を追加・変更した場合は、再デプロイが必要です。

ただし、Netlifyの管理画面での環境変数設定は、人間側の作業です。

コード修正AIは、Netlify管理画面で環境変数を設定したことにしないでください。

必要がある場合は、最後に人間へチャットで伝えてください。

# Microsoft Entra 側で必要な確認

Microsoft Entra 管理センター、または Microsoft Azure ポータル側で、対象アプリのリダイレクト URI 登録が必要です。

ただし、これはコード修正AIが実施する作業ではありません。

コード修正AIは、Entra側の設定が必要であることを、最後に人間へチャットで伝えてください。

# 検証内容

実装後、以下を確認してください。

## 1. build確認

```bash
npm run build
```

build が成功することを確認してください。

## 2. 直接アクセス時の確認

アプリ単体URLを直接開いた場合:

* 未ログインなら Microsoftログインボタンが表示される
* ログインボタン押下で loginRedirect が動く
* ログイン後、アプリ本体URLへ戻る
* 認証済みとしてアプリ本体が表示される
* redirect.html に戻って止まらない

## 3. iframe内の確認

可能であれば、ローカルで簡易ポータル iframe を作成して確認してください。

確認すること:

* 子アプリが AUTH_HINT_REQUEST を親へ送信する
* 親が AUTH_HINT を子へ返す
* 子アプリが AUTH_HINT を受け取る
* MSAL accounts が空でもアプリ本体が表示される
* iframe内で loginPopup / loginRedirect / ssoSilent が実行されない
* 白画面や無限ループが起きない

## 4. postMessage名の確認

以下のメッセージ名で統一されていることを確認してください。

子アプリ → 親ポータル:

```ts
{ type: "AUTH_HINT_REQUEST" }
```

親ポータル → 子アプリ:

```ts
{ type: "AUTH_HINT", loginHint: "...", name: "..." }
```

REQUEST_AUTH_INFO / AUTH_INFO など、別名になっていないことを確認してください。

## 5. 差分確認

```bash
git diff
```

Microsoftログインと無関係なファイルが変更されていないか確認してください。

未関係ファイルや未追跡ファイルはコミットしないでください。

# コミットとプッシュ

実装、build確認、差分確認が完了したら、変更内容をコミットしてください。

コミットメッセージ例:

```bash
git add 【変更した認証関連ファイルのみ】
git commit -m "Add Microsoft authentication support"
```

その後、現在の作業ブランチへ push してください。

```bash
git push
```

main に直接反映したくない場合は、必ず現在のブランチ名を確認してから push してください。

```bash
git branch
```

# 期待する最終状態

* ポータル iframe 内では、親ポータルのログイン情報を受け取ってアプリ本体を表示する。
* iframe 内では、子アプリ側で loginPopup / loginRedirect / ssoSilent を実行しない。
* 直接アクセス時は Microsoftログイン画面を表示し、loginRedirect でログインできる。
* ssoSilent は /redirect.html を使う。
* loginRedirect はアプリ本体URLへ戻る。
* iframe内で popup や ssoSilent による無限ループ・白画面が起きない。
* AUTH_HINT_REQUEST / AUTH_HINT のメッセージ名が親子で一致している。
* MSAL accounts に強く依存せず、iframe内では AUTH_HINT で表示できる。
* Microsoft Entra 側に、本体URLと /redirect.html の両方の登録が必要であることを、人間へチャットで案内できている。
* Netlify側に必要な環境変数の確認が必要であることを、人間へチャットで案内できている。
* npm run build が成功する。
* 既存の未関係ファイルや未追跡ファイルは触らない。

# 最後に人間へチャットで必ず伝える内容

実装完了後、またはコード修正の見通しが立った段階で、以下の内容を人間へチャットで別途伝えてください。

この内容は、コードのコメントではなく、チャット欄で人間に向けて説明してください。

---

人間側で必要な作業があります。

今回の Microsoftログイン対応は、コード修正だけでは完了しません。

Microsoft Entra 管理センター、または Microsoft Azure ポータル側で、対象アプリのリダイレクト URI 登録が必要です。

作業場所は以下です。

Microsoft Entra 管理センター
→ アプリの登録
→ 対象の社内アプリ認証アプリ
→ Authentication / 認証
→ Single-page application / シングルページ アプリケーション
→ Redirect URIs / リダイレクト URI

対象アプリごとに、以下の2種類の URI を登録してください。

1. アプリ本体の URL

例:

```txt
https://【対象アプリ名】.netlify.app
```

2. ssoSilent 用の redirect.html

例:

```txt
https://【対象アプリ名】.netlify.app/redirect.html
```

重要点です。

* /redirect.html は ssoSilent 専用の軽量なリダイレクト先です。
* 子アプリ本体のルートURLも、直接アクセス時の loginRedirect 用に登録してください。
* つまり、基本的に各アプリごとに「本体URL」と「/redirect.html付きURL」の2つを登録します。
* localhost で開発確認する場合は、必要に応じてローカルURLも追加してください。
* 例: http://localhost:3000
* 登録先のプラットフォームは「シングルページ アプリケーション」です。
* 変更後、反映に少し時間がかかる場合があります。

今回の例:

```txt
https://overall-project-schedule-48.netlify.app
https://overall-project-schedule-48.netlify.app/redirect.html
```

参考として、既存アプリの business-summary-table なども、以下の両方が登録されています。

```txt
https://business-summary-table.netlify.app
https://business-summary-table.netlify.app/redirect.html
```

注意点です。

リダイレクト URI が未登録、または片方しか登録されていない場合、コードが正しくても Microsoftログインが失敗します。

特に以下に注意してください。

* /redirect.html が未登録だと ssoSilent が失敗する可能性があります。
* アプリ本体URLが未登録だと、直接アクセス時の loginRedirect が失敗する可能性があります。

また、Netlify側にも、対象アプリで必要な環境変数が設定されているか確認してください。

Next.js の場合:

```env
NEXT_PUBLIC_MSAL_CLIENT_ID
NEXT_PUBLIC_MSAL_TENANT_ID
```

Vite / React の場合:

```env
VITE_MSAL_CLIENT_ID
VITE_MSAL_TENANT_ID
```

Netlifyに環境変数を追加・変更した場合は、再デプロイしてください。

以上の Entra 側リダイレクトURI登録と Netlify 側環境変数確認は、人間側または管理者権限を持つ担当者の作業です。

---

# growth-interview-manager で分かった重要な原因と対策

以下は growth-interview-manager への Microsoftログイン実装時に発生した問題です。

今後の別アプリへの実装でも同様の問題が起きる可能性が高いため、必ず対策してください。

## 1. ssoSilent がハングして画面が止まる問題

ssoSilent は、ブラウザ環境やネットワーク状態によって、エラーを返さずに無期限にハングすることがあります。

その結果、「Checking authentication...」のような読み込み画面のまま止まり、ログインボタンが表示されません。

対策として、ssoSilent には必ずタイムアウト（5秒程度）を設定してください。

```ts
try {
  const ssoPromise = instance.ssoSilent(ssoSilentRequest);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("ssoSilent timeout")), 5000)
  );
  const response = await Promise.race([ssoPromise, timeoutPromise]);
  if (response && response.account) {
    instance.setActiveAccount(response.account);
    setAuthState({ status: "authenticated", source: "msal", account: response.account });
  } else {
    setAuthState({ status: "unauthenticated" });
  }
} catch (error) {
  console.warn("ssoSilent failed:", error);
  setAuthState({ status: "unauthenticated" });
}
```

タイムアウトした場合は、エラーではなく「未認証」としてログインボタンを表示してください。

## 2. loginRedirect 後にログイン状態にならない問題

loginRedirect でMicrosoftログイン画面へ遷移し、ログイン完了後にアプリへ戻ってきても、ログインボタンが再度表示されてしまうことがあります。

原因は、AuthProvider 側で `handleRedirectPromise()` の戻り値を使っていなかったことです。

`handleRedirectPromise()` はリダイレクト後の認証レスポンスを返します。この戻り値から `account` を取得し、`setActiveAccount` で明示的に設定する必要があります。

```ts
const response = await msalInstance.handleRedirectPromise();
if (response && response.account) {
  msalInstance.setActiveAccount(response.account);
}
```

`await msalInstance.handleRedirectPromise()` だけでは、アカウントがアクティブに設定されず、AuthWrapper 側で検出できません。

## 3. AuthWrapper で useMsal の accounts だけに依存しない

AuthWrapper の useEffect で `useMsal()` の `accounts` だけを確認すると、handleRedirectPromise 完了直後のタイミングでアカウントを取りこぼすことがあります。

対策として、以下の3つすべてを確認してください。

```ts
const activeAccount = instance.getActiveAccount();
const allAccounts = instance.getAllAccounts();
const existingAccount = activeAccount || (allAccounts.length > 0 ? allAccounts[0] : null) || (accounts.length > 0 ? accounts[0] : null);

if (existingAccount) {
  instance.setActiveAccount(existingAccount);
  setAuthState({ status: "authenticated", source: "msal", account: existingAccount });
  return;
}
```

`getActiveAccount()` は handleRedirectPromise で設定されたアカウントを返します。

`getAllAccounts()` はキャッシュ内のすべてのアカウントを返します。

`useMsal()` の `accounts` はリアクティブですが、useEffect の実行タイミングによっては空の場合があります。

## 4. useEffect の依存配列に accounts を入れない

AuthWrapper の認証チェック useEffect の依存配列に `[instance, accounts]` を入れると、accounts の参照が変わるたびに useEffect が再実行されます。

しかし `initialized.current` で初回のみ実行するガードを入れている場合、再実行はスキップされるため意味がありません。

かえって、初回実行時に accounts が空の状態でキャプチャされ、その後 accounts が更新されても再実行されないという問題が起きます。

対策として、useEffect の依存配列は `[]` にし、useEffect 内では `instance.getActiveAccount()` や `instance.getAllAccounts()` を使ってください。

```ts
useEffect(() => {
  if (initialized.current) return;
  initialized.current = true;

  // instance.getActiveAccount() / instance.getAllAccounts() を使う
  // useMsal() の accounts には依存しない
}, []);
// eslint-disable-next-line react-hooks/exhaustive-deps
```

## 5. @azure/msal-browser の CacheOptions の型変更

新しいバージョンの `@azure/msal-browser` では、`CacheOptions` 型から `storeAuthStateInCookie` プロパティが削除されています。

以下のように書くとビルドエラーになります。

```ts
// NG: 型エラーになる
cache: {
  cacheLocation: "sessionStorage",
  storeAuthStateInCookie: false, // CacheOptions に存在しない
},
```

対策として、`storeAuthStateInCookie` は指定しないでください。

```ts
// OK
cache: {
  cacheLocation: "sessionStorage",
},
```
