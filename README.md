# Crystal Site Matcher

CIF ファイルの結晶構造で、あるサイトのイオンを別のイオンに置き換えたときに「入りそうかどうか」を、配位多面体の結合距離とシャノンのイオン半径から見積もる Web アプリです。ビルドすると HTML 1 ファイル（`dist/index.html`）になり、サーバーなしでブラウザで開けます。

## 使い方

1. 「CIF を開く」かドラッグ＆ドロップで CIF を読み込む（サンプル 6 種あり）。
2. 3D 表示で原子をクリックしてサイトを選ぶ。ドラッグで回転、右ドラッグで移動、ホイールで拡大。a / b / c / a* / b* / c* ボタンで軸方向から表示。
3. **サイト解析** タブ
   - 距離ストリップ上の線をドラッグするか「＋殻 / −殻」で結合距離の上限を変えると、配位数と多面体（3D 表示も）が切り替わる。
   - 適用範囲は「元素ペア全体」か「このサイトのみ」。
   - 配位数、多面体の形（理想多面体との CShM）、歪み指数、ECoN、二次伸長、結合角分散、BVS を表示。
   - サイトの空間半径 r_site = ⟨d − r_X⟩（r_X は配位子自身の配位数でのシャノン半径）とホストイオンのシャノン半径を比較。
4. **置換候補** タブ
   - シャノン表の全イオンを、同じ配位数での半径・BVS・価数差から採点してランキング。
   - イオン半径マップ、任意イオンの詳細評価、許容幅や価数フィルタの調整ができる。
5. **構造と結合** タブ
   - 酸化数の確認・修正（CIF に無ければ電荷中性から推定）、元素ペアごとの結合判定距離（初期値は VESTA と同じ）。

## 判定の考え方

| 指標 | 内容 |
| --- | --- |
| サイズ | Δr = (r_M − r_site)/r_site、S_size = exp(−½(Δr/σ)²)、σ は既定 15% |
| BVS | V = Σ exp((R₀ − d_i)/0.37)（Brese & O'Keeffe 1991）、S_BVS = exp(−½((V/\|q\| − 1)/0.25)²) |
| 価数差 | Δq = 0 → 1、±1 → 0.75、±2 → 0.5、それ以上 → 0.3 |
| 総合 | 重み付き幾何平均（0.6 / 0.25 / 0.15）× 100。75 以上「入りやすい」、50 以上「可能性あり」、25 以上「条件次第」 |

表に無い配位数の半径は隣接 CN から内挿（既定では外挿・代用値は除外）。結晶場安定化や共有結合性などは考慮しない幾何学的な目安です。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm run build      # dist/index.html（1 ファイル）を生成
npm run typecheck
```

技術構成: Vite + React + TypeScript + three.js（TrackballControls、ConvexGeometry）、`vite-plugin-singlefile` で 1 ファイル化。

### 参照データの再生成

`src/data/*.json` は pymatgen 同梱のデータから作っています。

```bash
python3 scripts/build-data.py <pymatgen リポジトリ> <pymatgen-core リポジトリ>
```

## 出典

- R. D. Shannon, *Acta Cryst.* A32, 751 (1976) — 有効イオン半径・結晶半径
- N. E. Brese & M. O'Keeffe, *Acta Cryst.* B47, 192 (1991) — 結合原子価パラメータ
- K. Momma & F. Izumi, VESTA — 結合判定距離の既定値
- pymatgen (MIT License) — 空間群の対称操作、理想配位多面体、元素データ
- サンプル構造: LiFePO₄ (Streltsov et al. 1993)、Y₃Al₅O₁₂ (Euler & Bruce 1965)、LiCoO₂ (Akimoto et al. 1998)、TiO₂ ルチル (Burdett et al. 1987)、MgAl₂O₄、SrTiO₃（文献値を丸めた代表値）
