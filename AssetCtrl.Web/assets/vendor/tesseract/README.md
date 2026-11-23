Text reading (OCR) for the camera scanner (assets/js/scanner.js). Loaded only when Text mode is used.

- tesseract.min.js, worker.min.js: tesseract.js 7.0.0 (Apache-2.0, LICENSE-tesseract.js.md)
- tesseract-core-lstm.wasm.js: tesseract.js-core 7.0.0, LSTM build that runs in every browser (Apache-2.0, LICENSE-tesseract-core.txt)
- lang/eng.traineddata.gz: English model, tessdata_best integer version 4.0.0 (Apache-2.0, from @tesseract.js-data/eng 1.0.0)

Barcode / QR reading is in ../zxing: barcode-detector 3.2.4 (MIT) with zxing-wasm 3.1.7 reader (MIT, zxing-cpp Apache-2.0).
