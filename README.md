# Local-Live-Translator

A powerful real-time speech translation application that captures audio, transcribes speech in multiple languages, and provides instantaneous translations with high accuracy - all running locally on your machine.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python: 3.9+](https://img.shields.io/badge/Python-3.9+-blue.svg)
![Framework: Flask](https://img.shields.io/badge/Framework-Flask-green.svg)

## ✨ Features

- **Real-time Audio Processing**: Captures and processes audio in real-time using WebRTC
- **Multilingual Support**: Automatically detects and transcribes 17+ languages
- **High-Quality Speech Recognition**: Powered by Whisper Large-v3-turbo for accurate transcription
- **Fast Translation**: Uses NLLB-200 translation model for quick and accurate translations
- **Interactive UI**: Clean interface with audio visualization, voice activity detection, and real-time updates
- **Export Options**: Export translations to multiple formats (TXT, DOCX, PDF, HTML, clipboard)
- **Advanced Audio Visualization**: Visual feedback with spectrum analysis and voice activity indication
- **Sentence Management**: Intelligent handling of partial transcripts for natural sentence formation
- **Language Auto-detection**: Automatically detects the spoken language with confidence metrics

## 🌐 Supported Languages

The application currently supports the following languages:

| Language | Code | Support |
|----------|------|---------|
| English | eng_Latn | Full |
| Korean | kor_Hang | Full |
| Japanese | jpn_Jpan | Full |
| Chinese (Simplified) | cmn_Hans | Full |
| German | deu_Latn | Full |
| French | fra_Latn | Full |
| Spanish | spa_Latn | Full |
| Russian | rus_Cyrl | Full |
| Portuguese | por_Latn | Full |
| Italian | ita_Latn | Full |
| Vietnamese | vie_Latn | Full |
| Thai | tha_Thai | Full |
| Indonesian | ind_Latn | Full |
| Dutch | nld_Latn | Full |
| Turkish | tur_Latn | Full |
| Arabic | ara_Arab | Full |
| Hindi | hin_Deva | Full |

## 🔧 Technology Stack

### Backend
- Python with Flask web framework
- Socket.IO for bidirectional communication
- Faster-Whisper for speech recognition
- NLLB-200 for neural machine translation
- LangDetect for language detection

### Frontend
- HTML5, CSS3, JavaScript
- Socket.IO for real-time communication
- Web Audio API for audio processing and visualization
- Libraries: docx.js, jsPDF, FileSaver.js

## 🖥️ System Requirements

- **Python**: 3.7+
- **GPU**: CUDA-compatible GPU recommended for optimal performance
- **Memory**: 8GB+ RAM recommended
- **Disk Space**: At least 10GB free space for model files
- **Browser**: Modern browser with WebRTC support
- **Network**: Stable internet connection

## 📦 Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/SkyFever/Local-Live-Translator.git
   cd Local-Live-Translator
   ```

2. **Set up the backend:**

   ```bash
   # Create and activate a virtual environment
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate

   # Install dependencies
   pip install -r requirements.txt
   ```

3. **Environment Configuration:**

   Create a `.env` file in the project root with:

   ```
   SECRET_KEY=your_secret_key_here
   ```

4. **Start the server:**

   ```bash
   python server/app.py
   ```

   The server will start on `http://localhost:7880` by default.

5. **Access the application:**

   Open `http://localhost:7880` in your web browser.

## 📱 Usage

1. **Select Languages:**
   - Choose source language (or use auto-detect)
   - Select target language for translation

2. **Start Recording:**
   - Click the "Start" button to begin capturing audio
   - Speak clearly into your microphone
   - View real-time transcription and translation

3. **End Session:**
   - Click "Stop" to end the recording session

4. **Export Results:**
   - Use the export controls to save translations in your preferred format
   - Choose which components to include (original text, translations, timestamps, language info)

## ⚙️ Advanced Configuration

### Server Configuration

You can modify the following parameters in `server/app.py`:

- `model_size`: Change the Whisper model size (e.g., 'medium', 'large-v2', 'large-v3')
- `device`: Set to 'cpu' if CUDA is not available
- `port`: Change the server port (default: 7880)

### Audio Processing

Adjust audio processing parameters in `app.py`:

- `MAX_BUFFER_SIZE`: Buffer size for audio chunks
- `min_processing_interval`: Minimum time between processing audio chunks
- Voice activity detection thresholds and parameters

## 📋 Troubleshooting

- **Microphone Access Issues**: Ensure your browser has permission to access the microphone
- **Performance Issues**: Consider using a smaller Whisper model if experiencing lag
- **Language Detection Problems**: Speak clearly and provide longer utterances for better language detection
- **Audio Quality Issues**: Try using a better microphone or reduce background noise for improved recognition

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.

### Usage Restrictions

This project uses NLLB-200 (No Language Left Behind) translation model from Meta AI which is licensed under the CC-BY-NC 4.0 license. Therefore:

- **Non-Commercial Use Only**: This application may only be used for non-commercial purposes without obtaining a separate license from Meta AI.
- **Attribution**: Appropriate attribution must be provided to Meta AI's NLLB-200 and other included open-source components.

For commercial use, you would need to replace NLLB-200 with an alternative translation solution or obtain a commercial license from Meta AI.

## 🙏 Acknowledgements

- [OpenAI Whisper](https://github.com/openai/whisper) for the speech recognition technology
- [Faster Whisper](https://github.com/guillaumekln/faster-whisper) for the optimized Whisper implementation
- [NLLB (No Language Left Behind)](https://github.com/facebookresearch/fairseq/tree/nllb) by Meta AI for the translation model
- [Socket.IO](https://socket.io/) for the real-time communication framework
- [Flask](https://flask.palletsprojects.com/) for the web application framework
