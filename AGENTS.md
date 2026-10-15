# AGENTS.md

コーディングエージェント（Claude Code など）向けの作業ガイドです。人間向けの説明は README.md を参照してください。

## プロジェクト概要

Crystal Site Matcher は CIF を読み込み、次の 2 つを行います。

- 置換イオンがサイトに入るかを、配位多面体の結合距離とシャノン半径から見積もる。
- イオン伝導体向けの構造特徴量（BVS、BVSE 浸透障壁、空隙、ホップのボトルネックなど）を計算する。

成果物は 2 つで、どちらもリポジトリにコミットします。

- `dist/index.html`: アプリ全体（React + three.js、データ込み）を 1 ファイルにしたもの。サーバー不要。
- `dist/csm-features.mjs`: 特徴量抽出の CLI。Node.js だけで動く 1 ファイル。

## コマンド

```bash
pnpm install
pnpm dev                 # 開発サーバー
pnpm build               # dist/index.html と dist/csm-features.mjs を生成（vite を 2 回実行）
pnpm typecheck           # tsc --noEmit
pnpm test                # node --test tests/*.test.mjs
pnpm features <cif...>   # CLI の実行（node dist/csm-features.mjs）

# 参照データ（src/data/*.json）の再生成。Python 環境は uv で固定
uv sync --locked
pnpm data:fetch          # scripts/sources.lock のコミットで上流リポジトリを取得
pnpm data                # src/data/*.json を生成
pnpm samples             # src/samples/*.cif を生成
```

`src/` を変えたら、PR を出す前に `pnpm typecheck && pnpm build && pnpm test` を通し、更新された `dist/` も同じ PR でコミットしてください。複数のコマンドは `&&` でつなぎ、途中で失敗したら止まるようにします。

## 依存パッケージとセキュリティ（重要）

- パッケージマネージャーは **pnpm（12.3.4 以上）だけ** を使います。npm / yarn / bun は使わず、それらのロックファイルも作りません。
- `pnpm-workspace.yaml` のサプライチェーン対策は**ユーザーの明示的な承認なしに緩めない**でください。対象の設定は次のとおりです。
  - `minimumReleaseAge`
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps`
  - `strictDepBuilds` / `allowBuilds`
  - `engineStrict`
  - `verifyStoreIntegrity`
- 例外（`trustPolicyExclude` など）が必要なときは、パッケージ全体ではなく**版を固定**します（例: `semver@6.3.1`）。理由もコメントに書いてください。
- 新しい依存はできるだけ追加しません。たとえば CLI では `@types/node` を入れず、使う Node API だけ `src/cli/node.d.ts` に型宣言しています。追加が必要なら理由を PR に書き、`pnpm-lock.yaml` を更新します。
- Python（`scripts/`）は uv で管理します。
  - `uv.lock` と `pyproject.toml` の `exclude-newer`（固定日時）と `index-strategy = "first-index"` を維持します。
  - 上流データ（pymatgen, pymatgen-core, BVlain）は `scripts/sources.lock` でコミット SHA を固定しています。
  - 再生成した `src/data/*.json` は、同じ入力ならバイト単位で同一になる必要があります。

## コード構成と設計ルール

```
src/lib/          計算ロジック（React・DOM に依存しない。CLI からも使う）
  cif.ts            CIF パーサー
  structure.ts      結晶・対称展開・近接リスト・酸化数推定
  spacegroup.ts     空間群の対称操作（pymatgen 由来データ）
  bonding.ts        結合判定距離（VESTA 既定値など）、deriveBonds（メモ化）
  analysis.ts       サイト解析（シャノン半径、BVS、CShM、置換候補のスコア）
  shape.ts          CShM（理想多面体との連続形状尺度）
  features.ts       特徴量の定義（FEATURE_DEFS）と静的特徴量・ホップ網
  bvse.ts           BVSE（softBV）場、グリッド計算、線分とイオンの最短距離
  percolation.ts    周期的 union-find（1D/2D/3D 浸透）
  xrd.ts            粉末 XRD
  pipeline.ts       アプリと CLI で共通の計算手順（構造準備 → 静的特徴量 → グリッド）
  doc.ts            アプリの「開いている構造」（表示設定などを含む）
  useFeatures.ts    アプリ用の非同期計算フック（pipeline.ts を使う）
src/components/   React コンポーネント
src/i18n/         ja.ts（基準）/ en.ts / translate.ts（React 非依存）/ index.tsx（Provider）/ domain.ts
src/cli/          csm-features（extract.ts = Node API なしの中核、csm-features.ts = 入出力）
src/data/         生成された参照データ（手で編集しない。scripts/ で再生成）
tests/            node:test。*-fixture.mjs が vite の ssrLoadModule で src を読み込む
```

- **`src/lib` に表示文字列を書かない。** エラーは `MsgError("err.xxx", params)`、警告は `msg(...)` で返します。分類はコード（`"cubic"`、`"interp"`、`"good"` など）で返し、UI 側で `t()` で翻訳します。
- **UI の文字列はすべて i18n 辞書に置く。** `ja.ts` が基準で、`en.ts` は同じキーを持つ必要があります（型でチェックされます）。キーを追加したら両方に書き、英語表示に日本語が残らないことを確認してください。CSV / CLI の出力は言語設定によらず英語です。
- **アプリと CLI の計算結果を一致させる。** 計算手順は `pipeline.ts` に置き、`useFeatures.ts` と `src/cli/extract.ts` の両方から使います。片方だけに計算を書かないでください。
- CLI のバンドルに React を入れないため、`src/lib`、`src/i18n/translate.ts`、`src/i18n/domain.ts` から React を import しないでください。
- 重い計算（BVSE グリッドなど）は、特徴量タブか比較モードを開いたときだけ実行します。起動時のタブは「構造と結合」です（#4）。
- TypeScript は strict で、`noUnusedLocals` / `noUnusedParameters` が有効です。書式は既存コードに合わせます（2 スペース、ダブルクォート、長めの行も可）。

## 計算上の約束事（変えるときは issue で相談）

- イオン半径は Shannon (1976)、結合原子価パラメータは Brese & O'Keeffe (1991) です。結合判定距離の既定値は VESTA の値です（ただしシャノン半径の和 × 1.1 を下限とする）。VESTA の値がない場合はシャノン半径の和 × 1.25、シャノン半径もない場合は原子半径の和 × 1.15 です。
- BVSE は BVlain / softBV と同じ式です（Morse 型項 + 遮蔽クーロン項, f = 0.74）。部分占有は占有率で重み付けします。
- 可動イオンの自動選択は Li → Na → K → Ag → Cu → Mg → Zn → Ca → Rb → Cs → H（陽イオン）、なければ F・O（陰イオン）の順です（`defaultMobile`）。
- ホップのボトルネック半径 `rb` は、直線経路上で通れる球の最大半径で、0 以上です。直線が骨格イオンの中心から半径の半分以内を通る組（`HOP_CORE_BLOCK`）はホップに数えません（#16）。
- 回帰の目安:
  - LiFePO₄ の E_1D ≈ 0.43 eV（BVlain の例は 0.44 eV）
  - LiCoO₂ の Li–Li ホップは 9 本で、すべて 2.8156 Å
  - グラフの目盛り計算は値の幅が浮動小数点誤差程度でも止まらないこと（#2）

## テストと確認

- 計算やフォーマットを変えたら `tests/` に回帰テストを追加します。fixture は vite の `ssrLoadModule` で `src/` を直接読み込みます。
- UI を変えたら、ブラウザで日本語・英語の両方、ライト・ダーク、スマホ幅（約 400px）を確認します。あわせて、コンソールエラーがないことと横スクロールが出ないことも確認します。
- CLI を変えたら `pnpm build` のあと `node dist/csm-features.mjs src/samples -o /tmp/f.csv` などで実際に動かします。
- ICSD など再配布できない CIF はコミットしません。回帰テストに使うときは `tests/private/`（gitignore 済み）か `CSM_PRIVATE_CIFS` のフォルダから読み、ファイルがなければスキップします（`tests/private.test.mjs`）。
  - 同梱が必要な構造は、CIF ファイルではなく原著論文の格子定数・座標・占有率を `scripts/make-samples.py` に入力し、出典を `ref` に書きます（LGPS とアルジロダイトがこの方法です）。

## Git / GitHub の進め方

1. **issue を作る**（日本語）。現象・原因・対応方針を書きます。
2. **ブランチを切る**: `feat/...`、`fix/...`、`chore/...`、`docs/...`。main に直接 push しません。
3. **コミットする**: メッセージは英語の命令形です（1 行目は要約、本文に理由）。
4. **PR を出す**: base は main、タイトルは英語、本文は日本語です。本文には次を含めます。
   - `Closes #N`
   - 変更内容
   - 確認したこと（コマンドと結果、数値の前後比較など）
5. **ユーザーの指示でマージする**: squash merge です。マージ後はローカルとリモートのブランチを削除します。
6. **依存する PR を重ねるとき**: base を前の PR のブランチにし、マージ順を PR に書きます。issue が自動で閉じるのは main にマージされたときだけです。

README.md は日本語です。機能や使い方を変えたら同じ PR で更新してください。
