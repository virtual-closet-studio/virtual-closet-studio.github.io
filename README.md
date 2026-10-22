# バーチャルクローゼット

- 公開サイト: https://virtual-closet-studio.github.io/
- コード管理: https://github.com/virtual-closet-studio/virtual-closet-studio.github.io
- 自動公開の実行状況: https://github.com/virtual-closet-studio/virtual-closet-studio.github.io/actions

端末内で服を管理し、3Dアバターでコーデを試せるWebアプリです。人体、Tシャツ、パーカー、スウェットパンツにユーザー提供の3Dデータを使用します。同じ服の形状に色や柄、アップロードした画像を適用します。旧版で登録したスカートだけは従来の簡易形状で表示します。

## 3Dモデル

| 表示 | 提供ファイル | 配置先 |
| --- | --- | --- |
| 人体 | `a_smpl_male.obj` | `public/models/body.obj` |
| Tシャツ | `LP_tshirt.obj` | `public/models/tshirt.obj` |
| パーカー | `hoodie.glb` | `public/models/hoodie.glb` |
| スウェットパンツ | `trousers_design_patent.glb` | `public/models/sweatpants.glb` |

GLBの2ファイルはWeb表示用にglTF Transformで頂点数、座標精度、テクスチャを調整しました。元ファイルは変更していません。パンツは元の座標が人体から離れているため、表示時に中心へ移動します。人体の腕は服の袖に合わせて表示時に下げています。モデル間で骨格や型紙の共有はないため、体形スライダーは全体の拡縮による簡易調整です。

## 開発

### 追加素材

インナーには既存Tシャツ・シャツ・パーカー、アウターにはダブルジャケット、靴にはレザーブーツとスニーカーを登録しています。提供OBJを `scripts/convert-garments.mjs` でGLBに変換し、ジャケットは約360 MBから約2.5 MBに軽量化しました。元ファイルは変更しません。再変換は `node --max-old-space-size=8192 scripts/convert-garments.mjs` を実行します。入力はユーザーのDownloadsフォルダーです。

シャツの同梱画像を取り込んでいます。靴のMTLとジャケットが参照する外部画像は同梱されていないため、アプリで指定した色を使用します。靴は左右それぞれの向きと足首位置を揃えています。上半身の服は頂点を局所的に変形せず、全体の寸法と襟元・胸の位置を合わせます。肩や袖を円筒に広げる処理や、胴体断面を膨らませる処理はありません。重ね着ではインナーの全体寸法に隙間を設け、ジャケットで覆われる袖だけを描画時に隠します。脱衣時には元の形状をそのまま表示します。肌は覆われる胴体と袖内だけを元の人体座標で非表示にし、首と手は保持します。パンツの肌隠しも元の人体座標で判定します。

既存保存データには4点を一度だけ追加し、削除した素材は復活させません。パーカーはユーザー作成分も含めてインナーへ移動します。旧コーデにパーカーと別のインナーが両方ある場合は、パーカーをインナーの着用枠に移し、元の服は登録一覧に保持します。保存データ更新の検証は `node scripts/test-materials.mjs`、上半身の頂点を変形しないことと体形別の襟元・裾の検証は `node scripts/test-fitting.mjs` で実行できます。

Node.js 24を使用します。通常のビルドでは生成済みの `public/fit.wasm` を使うのでRustは不要です。フィット計算を変更して再生成する場合だけRust（`wasm32-unknown-unknown`ターゲット）が必要です。

```powershell
npm ci
npm test
npm run dev
```

本番用: `npm run build`。出力先は`dist/`です。`public/fit.wasm`は生成済みのRust製WebAssemblyとしてリポジトリにも含めます。

## 保存と制限

- 服とコーデはブラウザーのIndexedDBに保存されます。従来のテクスチャ画像は最大512px、WebP品質0.72、写真追加の画像は最大1024px、WebP品質0.9に縮小します。
- 「データを書き出す」で写真デザインを含むバージョン2のJSONバックアップを保存できます。「データを読み込む」はバージョン1・2（50 MB以下）に対応します。内容を確認し、必要なら現在のデータを書き出してから「置き換えて読み込む」を選択します。統合ではなく全体の置き換えです。不正なファイルや保存失敗時は元のデータを保持します。
- ブラウザーのサイトデータ削除や容量制限によって端末内データが失われる可能性があります。容量不足時は保存に失敗した旨を表示し、直前のデータを維持します。
- 体形調整と衣服は簡易3D表現です。写真からの3D生成、布の物理シミュレーション、実寸のサイズ判定、端末間同期には対応していません。

## 写真から追加

「写真から追加」では、服単体の正面写真から既存9種類の形の候補を提示し、切り抜いた写真を3Dの服に投影します。JPEG・PNG・WebP、1枚15 MB以下に対応。背景の自動除去、消去・復元ブラシ、範囲の切り抜き、基本色の抽出、位置・大きさ・回転の調整ができます。背面写真は任意で、ない場合は基本色になります。保存前の変更は一時プレビューだけに反映され、キャンセルで破棄します。保存後も服の「⋯」から再編集できます。

分類は `@huggingface/transformers` と `Xenova/clip-vit-base-patch32` のq8モデルをWeb WorkerのWASMで実行します。モデルrevisionは `d15189d7028b43f1d3e65039190477f6af591c2a` に固定。Hugging Faceからモデルを取得してブラウザーにキャッシュします。写真は端末内で処理し、Workerには縮小した画素を渡すだけで、画像を外部APIへ送りません。APIキー・有料API・追加サーバーは不要です。初回取得には時間と通信量が必要です。中止・失敗時も手動選択で保存でき、推定を再試行できます。

正面／背面は元モデルのUVと独立した投影です。モデルの輪郭・撮影方向に近い写真ほど自然に見えます。袖などの形の違い、写真のしわや影は完全には補正できません。白い服と白い背景、複雑な背景は手動補正を使ってください。写真にない柄・シルエットは生成しません。加工画像と、消去箇所を復元するための切り抜き元画像を保存します。

`npm test` は切り抜き・柄の保持・色抽出・写真バックアップ・9種類の投影設定・既存の重ね着シェーダーとの合成・テクスチャ解放も検証します。`powershell -File scripts/create-photo-fixtures.ps1` で合成テスト画像を `.cache/photo-fixtures/` に生成できます。無地・ボーダー・チェック・文字入りのTシャツ合成画像4枚による初期ブラウザー検証では、第1候補の一致は3/4、第3候補以内は4/4でした（チェックはシャツが第1候補、Tシャツが第2候補）。これは実写・全カテゴリの精度保証ではありません。

## GitHub Pagesでの無料公開

無料Organization `virtual-closet-studio` の公開リポジトリ `virtual-closet-studio.github.io` を使います。GitHub Free、標準のGitHub-hosted runner、GitHub Pagesの範囲で動き、有料API・サーバー・独自ドメインは不要です。利用制限はGitHub Pagesの公式ドキュメントに従います。

1. このフォルダーの内容を公開リポジトリのルートへ登録します。
2. GitHubの Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定します。
3. `main` にpushすると `.github/workflows/deploy.yml` がテスト・ビルド・公開を実行します。Actions → Publish GitHub Pages → Run workflow から手動実行もできます。
4. 公開先は `https://virtual-closet-studio.github.io/` です。実際のURLと成功状態はActionsまたはPages設定で確認します。

更新はこのフォルダーでコードを編集して `npm test` と `npm run build` を実行し、変更をcommitして `main` にpushします。素材追加時は `public/models/` へ配置します。失敗したビルドは公開されず、直前の成功版が残ります。取り消す場合は対象commitをrevertしてpushします。

以後の更新先はOrganizationの新リポジトリに統一します。従来の個人リポジトリと公開サイトは、データ書き出し用に保持します。Organizationサイトではリポジトリ名を `virtual-closet-studio.github.io`、`vite.config.js` の `base` を `/` にします。ローカル確認は `npm run dev`、本番成果物の確認は `npm run build` → `npm run preview` を使い、表示されたURLの `/` を開きます。

`node_modules`、`dist`、キャッシュ、秘密情報、個人のバックアップJSONはリポジトリに登録しません。同梱3D素材の公開許可は今回の移行で確認済みですが、第三者への再配布ライセンスを新たに付与するものではありません。

## 旧サイトからのデータ移行

1. 保存データのあるブラウザーで [従来のGitHub Pagesサイト](https://aizaaaaap.github.io/virtual-closet/) または [旧Sitesサイト](https://closet-studio-vrtryon.aizap.chatgpt.site/) を開き、「データを書き出す」を選びます。
2. 新しいGitHub Pagesのサイトを開き、「データを読み込む」から保存したJSONを選びます。
3. 件数を確認して「置き換えて読み込む」を選びます。
4. 服・画像・コーデ・体形を確認し、再読み込みして保存できていることを確認します。

URLが変わるため旧サイトのIndexedDBは自動では引き継がれません。旧サイトとその保存データはそのまま残ります。各利用者が自分のブラウザーでこの移行を行います。バックアップJSONはGitHubへアップロードせず、手元で保管してください。

移行元: Sitesバージョン20、ソースcommit `ea6e4a76f46b6561d82a5b66fc56d03b74d52410`。移行前にソースとモデルがローカル作業版と一致することを確認しました。
