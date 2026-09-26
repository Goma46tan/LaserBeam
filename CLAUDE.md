# LaserBeam

サイバー風3D物理パズル（スマホ向けWebゲーム）。カメラ固定の砲台からレーザーを撃ち、台座上のネオンブロックを落とす。全1000ステージ。仕様書は `md/アプリ指示書.md`（gitignore対象）。

- ユーザーとのやり取りは**日本語**。
- スタック: three.js r160 + cannon-es（`lib/` に同梱）、ES modules + import map。**ビルド工程なし・npm依存なし**。
- `file://` では動かない。ローカル確認は `python -m http.server 8765 --bind 127.0.0.1`（プロジェクトルートで）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `js/core3d.js` | ステージ生成 `generate(n, variant)`、`getStage`、`cameraFor`、物理 `Sim`、`SIM_OPTS`、`GIMMICKS`、`BOSSES`、`difficulty(n)` |
| `js/render3d.js` | ネオンブロックのシェーダ、ブルーム、エフェクト、敵メッシュ |
| `js/main3d.js` | 画面遷移・UI・セーブ（エントリポイント） |
| `js/gear.js` / `js/shop.js` | 装備（5スロット）とPTショップ |
| `js/enemies.js` | 敵システム（ステージ15以降） |
| `js/i18n.js` | 6言語（ja/en/zh-Hans/zh-Hant/ko/es）。キー追加時は全言語に追加する |
| `js/audio.js` | 合成SFX/BGM（**classic script**、moduleではない） |
| `js/budget3d.js` | **自動生成**（各ステージの [variant, レーザー数]）。手で編集しない |
| `tools/precompute3d.mjs` | 全ステージをボットで検証し `budget3d.js` を生成 |
| `tools/smoke3d.mjs` | 初期配置の安定性チェック（`node tools/smoke3d.mjs 1 60`） |
| `tools/version.mjs` | index.html にキャッシュバスティング用ハッシュを刻印 |

## 重要なルール

- **`generate()` やその乱数消費を変えたら必ず再検証**: `node tools/precompute3d.mjs 1 1000 --jobs 4 --js`（約4〜5分）。レーザー数は生成レイアウトに厳密に依存する。
- 既存レイアウトを変えてはいけない新機能（敵・ボス演出など）は別RNG `makeRng(hash(...))` を使い、フィーチャーループでは `boss*` / `enemy*` キーをスキップする。変更前後で全ステージの `generate(n, v)` 出力を比較して確認する。
- 物理チューニングの試行は `LB_OPTS='{"blastK":..}'` 環境変数で `SIM_OPTS` を上書きできる。
- ゲームデザイン上の好み（崩壊の爽快感、頭でっかちな構造・狭い台座、ブロックを大きく映すほぼ正面のカメラ）を維持すること。

## ブラウザでの動作確認

- 自動操作タブは `hidden` 扱いで rAF が止まる → `window.LB.startStage(n)` と `LB.debugAdvance(sec)` を使う。
- モジュールの強制再取得は `fetch(url, {cache:'reload'})` の後にリロード。
- スマホサイズ確認用の一時ファイル（`_phone.html` の iframe 330x710 など）はコミット前に削除。

## リリース手順

1. `node tools/version.mjs`（import map と `?v=` にハッシュ、`<meta name="lb-version">` にビルドIDを刻印）
2. コミット & `git push`（GitHub: Goma46tan/LaserBeam、main。GitHub Pages でも公開）
3. 本番 https://mobapp.site/laserbeam/ はユーザーが手動アップロード。対象: `index.html`, `css/`, `js/`, `lib/`, `manifest.webmanifest`, `icon.svg`（`tools/`, `md/`, `movie/` は不要）
