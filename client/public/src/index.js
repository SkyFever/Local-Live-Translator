// index.js - 다국어 지원 기능 추가
const socket = io('http://localhost:7880', {
    transports: ['websocket']
});

// 오디오 관련 변수들
let isRecording = false;
let audioContext = null;
let scriptProcessor = null;
let source = null;
let processingAudio = false;
let audioChunkCount = 0;

// 내보내기 관련 변수들
let exportOptions = {
    original: true,
    translation: true,
    timestamp: true,
    languageInfo: false
};

// 언어 관련 변수
let currentSourceLanguage = 'eng_Latn';  // 기본 소스 언어: 영어
let currentTargetLanguage = 'kor_Hang';  // 기본 타겟 언어: 한국어
let isAutoDetectEnabled = true;          // 자동 감지 기본값: 활성화
let detectedLanguage = null;             // 감지된 언어 코드
let languageConfidence = 0;              // 언어 감지 신뢰도

// 내보내기 버튼 및 옵션 엘리먼트
let exportTextBtn, exportWordBtn, exportPDFBtn, exportHTMLBtn, copyToClipboardBtn;
let exportOriginalCheck, exportTranslationCheck, exportTimestampCheck, exportLanguageInfoCheck;

// 지원 언어 정보
// FIXED: whisperCode 속성 제거 (사용되지 않음)
const supportedLanguages = {
    "eng_Latn": { name: "영어 (English)", code: "en" },
    "kor_Hang": { name: "한국어 (Korean)", code: "ko" },
    "jpn_Jpan": { name: "일본어 (Japanese)", code: "ja" },
    "cmn_Hans": { name: "중국어 간체 (Chinese Simplified)", code: "zh" },
    "deu_Latn": { name: "독일어 (German)", code: "de" },
    "fra_Latn": { name: "프랑스어 (French)", code: "fr" },
    "spa_Latn": { name: "스페인어 (Spanish)", code: "es" },
    "rus_Cyrl": { name: "러시아어 (Russian)", code: "ru" },
    "por_Latn": { name: "포르투갈어 (Portuguese)", code: "pt" },
    "ita_Latn": { name: "이탈리아어 (Italian)", code: "it" },
    "vie_Latn": { name: "베트남어 (Vietnamese)", code: "vi" },
    "tha_Thai": { name: "태국어 (Thai)", code: "th" },
    "ind_Latn": { name: "인도네시아어 (Indonesian)", code: "id" },
    "nld_Latn": { name: "네덜란드어 (Dutch)", code: "nl" },
    "tur_Latn": { name: "터키어 (Turkish)", code: "tr" },
    "ara_Arab": { name: "아랍어 (Arabic)", code: "ar" },
    "hin_Deva": { name: "힌디어 (Hindi)", code: "hi" }
};

// 타이머 변수
let forcedUpdateTimer = null;
let lastUpdateTime = 0;
const MAX_WAIT_TIME = 3000; // 최대 3초 대기

// 오디오 시각화를 위한 변수들
let audioAnalyser = null;
let audioDataArray = null;
let spectrumCanvas = null;
let spectrumContext = null;
let audioVisualizerTimer = null;
let audioLevelBar = null;
let voiceActivityIndicator = null;
let lastVoiceActivityTime = 0;
const VOICE_ACTIVITY_THRESHOLD = 0.01;
const VOICE_ACTIVITY_TIMEOUT = 500;

// 윈도우 사이즈 변경에 대응하기 위한 변수
let canvasWidth = 0;
let canvasHeight = 0;

// UI 요소
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const transcriptionResult = document.getElementById('transcriptionResult');
const translationResult = document.getElementById('translationResult');
const logContainer = document.getElementById('logContainer');
const sourceLanguageSelect = document.getElementById('sourceLanguage');
const targetLanguageSelect = document.getElementById('targetLanguage');
const autoDetectToggle = document.getElementById('autoDetectToggle');
const detectedLanguageElement = document.getElementById('detectedLanguage');

// 문장 관리 변수
let partialDiv = null;
let completedTranscriptions = [];
let completedTranslations = [];
let currentPartialText = '';

// 언어 선택 이벤트 리스너 강화
function setupLanguageControls() {
    // UI 요소 존재 확인
    // FIXED: UI 요소가 없을 경우 대비한 안전성 체크 추가
    if (!sourceLanguageSelect || !targetLanguageSelect || !autoDetectToggle) {
        console.error("언어 컨트롤 요소를 찾을 수 없습니다.");
        return;
    }
    
    // 소스 언어 변경 이벤트
    sourceLanguageSelect.addEventListener('change', function() {
        const newSourceLang = this.value;
        
        // 자동 감지 선택 시
        if (newSourceLang === 'auto') {
            autoDetectToggle.checked = true;
            isAutoDetectEnabled = true;
            updateStatus('자동 감지 모드가 활성화되었습니다. 말하기 시작하면 언어가 감지됩니다.');
        } else {
            // 수동 선택 모드
            currentSourceLanguage = newSourceLang;
            
            // 자동 감지 비활성화
            autoDetectToggle.checked = false;
            isAutoDetectEnabled = false;
            
            // 같은 언어로 번역 방지
            if (currentSourceLanguage === currentTargetLanguage) {
                // 소스와 타겟이 같으면 기본 타겟 언어로 변경
                currentTargetLanguage = (currentSourceLanguage === 'eng_Latn') ? 'kor_Hang' : 'eng_Latn';
                targetLanguageSelect.value = currentTargetLanguage;
            }
            
            updateStatus(`소스 언어가 ${supportedLanguages[newSourceLang].name}(으)로 변경되었습니다. 자동 감지가 비활성화되었습니다.`);
        }
        
        updateDetectedLanguageDisplay();
        
        // 언어 설정이 변경되면 서버에 즉시 알림
        updateLanguageConfig();
    });
    
    // 타겟 언어 변경 이벤트
    targetLanguageSelect.addEventListener('change', function() {
        const newTargetLang = this.value;
        currentTargetLanguage = newTargetLang;
        
        // 같은 언어로 번역 방지
        if (currentSourceLanguage === currentTargetLanguage && currentSourceLanguage !== 'auto') {
            // 소스와 타겟이 같으면 자동 감지 활성화
            sourceLanguageSelect.value = 'auto';
            autoDetectToggle.checked = true;
            isAutoDetectEnabled = true;
            updateStatus(`번역 언어가 ${supportedLanguages[newTargetLang].name}(으)로 변경되었습니다. 자동 감지가 활성화되었습니다.`);
        } else {
            updateStatus(`번역 언어가 ${supportedLanguages[newTargetLang].name}(으)로 변경되었습니다.`);
        }
        
        updateDetectedLanguageDisplay();
        updateLanguageConfig();
    });
    
    // 자동 감지 토글 이벤트
    autoDetectToggle.addEventListener('change', function() {
        isAutoDetectEnabled = this.checked;
        
        if (isAutoDetectEnabled) {
            sourceLanguageSelect.value = 'auto';
            detectedLanguage = null;
            languageConfidence = 0;
            updateStatus('언어 자동 감지가 활성화되었습니다. 말하기 시작하면 언어가 감지됩니다.');
        } else {
            // 자동 감지가 꺼지면 기본 언어로 설정
            // 감지된 언어가 있으면 그 언어를 사용, 없으면 영어 기본값
            if (detectedLanguage) {
                sourceLanguageSelect.value = detectedLanguage;
                currentSourceLanguage = detectedLanguage;
                updateStatus(`언어 자동 감지가 비활성화되었습니다. 소스 언어가 ${supportedLanguages[detectedLanguage]?.name || detectedLanguage}(으)로 설정되었습니다.`);
            } else {
                sourceLanguageSelect.value = 'eng_Latn';
                currentSourceLanguage = 'eng_Latn';
                updateStatus('언어 자동 감지가 비활성화되었습니다. 소스 언어가 영어로 설정되었습니다.');
            }
        }
        
        updateDetectedLanguageDisplay();
        updateLanguageConfig();
    });
}

// 감지된 언어 표시 업데이트
function updateDetectedLanguageDisplay() {
    if (!detectedLanguageElement) return;
    
    if (isAutoDetectEnabled) {
        if (detectedLanguage) {
            const langInfo = supportedLanguages[detectedLanguage] || { name: detectedLanguage };
            
            if (languageConfidence > 0) {
                const confidence = Math.round(languageConfidence * 100);
                detectedLanguageElement.textContent = `감지된 언어: ${langInfo.name} (확률: ${confidence}%)`;
            } else {
                detectedLanguageElement.textContent = `감지된 언어: ${langInfo.name}`;
            }
            
            detectedLanguageElement.classList.add('active');
        } else {
            detectedLanguageElement.textContent = '감지된 언어: 말씀하시면 감지합니다';
            detectedLanguageElement.classList.remove('active');
        }
    } else {
        const sourceLang = sourceLanguageSelect.value;
        const langInfo = supportedLanguages[sourceLang] || { name: sourceLang };
        
        detectedLanguageElement.textContent = `선택된 언어: ${langInfo.name} (자동 감지 꺼짐)`;
        detectedLanguageElement.classList.remove('active');
    }
}

// 로그 컨테이너 초기화
function clearLogContainer() {
    if (!logContainer) return;
    logContainer.innerHTML = '';
}

// 상태 업데이트 함수
function updateStatus(message, isError = false) {
    if (!logContainer) return;
    
    const statusDiv = document.createElement('div');
    statusDiv.textContent = message;
    statusDiv.style.color = isError ? 'red' : 'green';
    statusDiv.style.padding = '5px';
    logContainer.appendChild(statusDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
    console.log(message);
}

// 오디오 시각화 초기화
function initAudioVisualization() {
    audioLevelBar = document.getElementById('audioLevelBar');
    voiceActivityIndicator = document.getElementById('voiceActivityIndicator');
    spectrumCanvas = document.getElementById('audioSpectrum');
    
    if (!spectrumCanvas) {
        console.error('Spectrum canvas element not found');
        return;
    }
    
    spectrumContext = spectrumCanvas.getContext('2d');
    canvasWidth = spectrumCanvas.width;
    canvasHeight = spectrumCanvas.height;
    adjustCanvasSize();
    window.addEventListener('resize', adjustCanvasSize);
}

// 캔버스 크기 조정 함수
function adjustCanvasSize() {
    if (!spectrumCanvas) return;
    
    const container = spectrumCanvas.parentElement;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    
    spectrumCanvas.width = rect.width;
    canvasWidth = rect.width;
    
    drawSpectrumBackground();
}

// 스펙트럼 배경 그리기
function drawSpectrumBackground() {
    if (!spectrumContext) return;
    
    const gradient = spectrumContext.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, 'rgba(66, 153, 225, 0.2)');
    gradient.addColorStop(1, 'rgba(49, 130, 206, 0.05)');
    
    spectrumContext.fillStyle = gradient;
    spectrumContext.fillRect(0, 0, canvasWidth, canvasHeight);
    
    spectrumContext.strokeStyle = 'rgba(226, 232, 240, 0.2)';
    spectrumContext.lineWidth = 1;
    
    for (let i = 0; i < canvasHeight; i += 20) {
        spectrumContext.beginPath();
        spectrumContext.moveTo(0, i);
        spectrumContext.lineTo(canvasWidth, i);
        spectrumContext.stroke();
    }
    
    for (let i = 0; i < canvasWidth; i += 50) {
        spectrumContext.beginPath();
        spectrumContext.moveTo(i, 0);
        spectrumContext.lineTo(i, canvasHeight);
        spectrumContext.stroke();
    }
}

// 오디오 레벨 업데이트 함수
function updateAudioLevel(level) {
    if (!audioLevelBar) return;
    
    const percentage = Math.min(100, Math.max(0, level * 100 * 5));
    audioLevelBar.style.width = `${percentage}%`;
    
    if (percentage > 70) {
        audioLevelBar.style.background = 'linear-gradient(to right, #48bb78, #f56565)';
    } else {
        audioLevelBar.style.background = 'linear-gradient(to right, #48bb78, #4299e1)';
    }
    
    updateVoiceActivity(level);
}

// 음성 활동 상태 업데이트
function updateVoiceActivity(level) {
    if (!voiceActivityIndicator) return;
    
    const currentTime = Date.now();
    const isActive = level > VOICE_ACTIVITY_THRESHOLD;
    
    if (isActive) {
        lastVoiceActivityTime = currentTime;
        
        if (!voiceActivityIndicator.classList.contains('active')) {
            voiceActivityIndicator.classList.add('active');
            const textElement = voiceActivityIndicator.querySelector('.indicator-text');
            if (textElement) {
                textElement.textContent = '음성 감지됨';
            }
        }
    } else if (currentTime - lastVoiceActivityTime > VOICE_ACTIVITY_TIMEOUT) {
        if (voiceActivityIndicator.classList.contains('active')) {
            voiceActivityIndicator.classList.remove('active');
            const textElement = voiceActivityIndicator.querySelector('.indicator-text');
            if (textElement) {
                textElement.textContent = '무음 상태';
            }
        }
    }
}

// 오디오 스펙트럼 업데이트
function updateAudioSpectrum() {
    if (!spectrumContext || !audioAnalyser || !audioDataArray) return;
    
    audioAnalyser.getByteFrequencyData(audioDataArray);
    
    drawSpectrumBackground();
    
    const barWidth = (canvasWidth / audioDataArray.length) * 0.8;
    const barSpacing = (canvasWidth / audioDataArray.length) * 0.2;
    const barHeightMultiplier = canvasHeight / 256;
    
    spectrumContext.fillStyle = 'rgba(66, 153, 225, 0.7)';
    
    spectrumContext.beginPath();
    spectrumContext.moveTo(0, canvasHeight);
    
    for (let i = 0; i < audioDataArray.length; i++) {
        let value = audioDataArray[i];
        
        const normalizedFreq = i / audioDataArray.length;
        if (normalizedFreq < 0.1 || normalizedFreq > 0.8) {
            value = value * 0.5;
        }
        
        if (normalizedFreq > 0.2 && normalizedFreq < 0.6) {
            value = value * 1.2;
        }
        
        const barHeight = value * barHeightMultiplier;
        const x = i * (barWidth + barSpacing);
        const y = canvasHeight - barHeight;
        
        spectrumContext.lineTo(x, y);
    }
    
    spectrumContext.lineTo(canvasWidth, canvasHeight);
    spectrumContext.closePath();
    
    const gradient = spectrumContext.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, 'rgba(72, 187, 120, 0.8)');
    gradient.addColorStop(0.5, 'rgba(66, 153, 225, 0.6)');
    gradient.addColorStop(1, 'rgba(66, 153, 225, 0.1)');
    
    spectrumContext.fillStyle = gradient;
    spectrumContext.fill();
    
    spectrumContext.strokeStyle = 'rgba(72, 187, 120, 0.8)';
    spectrumContext.lineWidth = 2;
    spectrumContext.stroke();
}

// 오디오 시각화 시작
function startAudioVisualization() {
    if (!audioAnalyser || !audioContext) return;
    
    audioAnalyser.fftSize = 256;
    const bufferLength = audioAnalyser.frequencyBinCount;
    audioDataArray = new Uint8Array(bufferLength);
    
    drawSpectrumBackground();
    
    cancelAnimationFrame(audioVisualizerTimer);
    
    function visualize() {
        if (!isRecording) return;
        
        audioAnalyser.getByteTimeDomainData(audioDataArray);
        
        let sum = 0;
        for (let i = 0; i < audioDataArray.length; i++) {
            const amplitude = (audioDataArray[i] - 128) / 128;
            sum += amplitude * amplitude;
        }
        const rms = Math.sqrt(sum / audioDataArray.length);
        
        updateAudioLevel(rms);
        updateAudioSpectrum();
        
        audioVisualizerTimer = requestAnimationFrame(visualize);
    }
    
    visualize();
}

// 오디오 시각화 중지
function stopAudioVisualization() {
    cancelAnimationFrame(audioVisualizerTimer);
    
    if (audioLevelBar) {
        audioLevelBar.style.width = '0%';
    }
    
    if (voiceActivityIndicator) {
        voiceActivityIndicator.classList.remove('active');
        const textElement = voiceActivityIndicator.querySelector('.indicator-text');
        if (textElement) {
            textElement.textContent = '무음 상태';
        }
    }
    
    if (spectrumContext) {
        drawSpectrumBackground();
    }
}

// 강제 업데이트 함수
function checkForForcedUpdate() {
    const currentTime = Date.now();
    // 8초 이상 경과 확인
    if (currentTime - lastUpdateTime > 8000 && currentPartialText && currentPartialText.length > 10) {
        console.log("강제 업데이트 실행:", currentPartialText);
        
        socket.emit('force_process', {
            text: currentPartialText
        });
        
        lastUpdateTime = currentTime;
    }
}

// 언어 정보 업데이트 함수 - 서버에 선택된 언어 정보 전송
function updateLanguageConfig() {
    const languageConfig = {
        sourceLanguage: isAutoDetectEnabled ? 'auto' : currentSourceLanguage,
        targetLanguage: currentTargetLanguage,
        autoDetect: isAutoDetectEnabled
    };
    
    socket.emit('update_language_config', languageConfig);
    console.log('Language config updated:', languageConfig);
}

// 오디오 처리 함수
function startRecording() {
    if (isRecording) return;
    
    updateStatus("시작 버튼이 클릭되었습니다.");
    
    // 이전 결과 초기화
    clearResults();
    
    // 언어 설정 업데이트
    updateLanguageConfig();
    
    // 녹음 시작 이벤트 전송
    socket.emit('start_recording');
    
    // 오디오 중첩 카운트 초기화
    audioChunkCount = 0;
    lastUpdateTime = Date.now();
    
    // 강제 업데이트 타이머 설정
    forcedUpdateTimer = setInterval(checkForForcedUpdate, 8000);
    
    // FIXED: 오류 처리 개선
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateStatus("이 브라우저는 마이크 액세스를 지원하지 않습니다.", true);
        return;
    }
    
    navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    })
    .then(stream => {
        isRecording = true;
        
        try {
            // 오디오 컨텍스트 생성
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            // 마이크 입력 소스 생성
            source = audioContext.createMediaStreamSource(stream);
            
            // 오디오 분석기 생성 (시각화용)
            audioAnalyser = audioContext.createAnalyser();
            audioAnalyser.minDecibels = -90;
            audioAnalyser.maxDecibels = -10;
            audioAnalyser.smoothingTimeConstant = 0.85;
            
            // 스크립트 프로세서 노드 생성
            scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            
            // 연결: 소스 -> 분석기 -> 스크립트 프로세서 -> 목적지
            source.connect(audioAnalyser);
            audioAnalyser.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);
            
            // 오디오 처리 콜백
            scriptProcessor.onaudioprocess = function(audioProcessingEvent) {
                if (!isRecording) return;
                
                if (processingAudio) return;
                processingAudio = true;
                
                const inputBuffer = audioProcessingEvent.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                
                socket.emit('chunk_number', audioChunkCount++);
                
                if (socket.connected) {
                    socket.emit('audio_chunk', inputData.buffer);
                }
                
                setTimeout(() => {
                    processingAudio = false;
                }, 50);
            };
            
            updateStatus("녹음이 시작되었습니다.");
            
            // 버튼 상태 업데이트
            if (startButton) startButton.disabled = true;
            if (stopButton) stopButton.disabled = false;
            
            // 녹음 중 상태 표시
            const statusDiv = document.createElement('div');
            statusDiv.className = 'recording-status';
            statusDiv.textContent = '🎙️ 녹음 중...';
            statusDiv.style.color = 'red';
            statusDiv.style.fontWeight = 'bold';
            statusDiv.style.margin = '10px 0';
            statusDiv.style.textAlign = 'center';
            
            // 이전 상태 메시지 제거
            const oldStatus = document.querySelector('.recording-status');
            if (oldStatus) oldStatus.remove();
            
            const controlsElement = document.querySelector('.controls');
            if (controlsElement) {
                controlsElement.appendChild(statusDiv);
            }
            
            // 오디오 시각화 시작
            startAudioVisualization();
        } catch (err) {
            updateStatus(`오디오 컨텍스트 초기화 오류: ${err.message}`, true);
            isRecording = false;
        }
    })
    .catch(err => {
        updateStatus(`마이크 접근 오류: ${err.message}`, true);
    });
}

// 결과 초기화 함수
function clearResults() {
    if (transcriptionResult) transcriptionResult.innerHTML = '';
    if (translationResult) translationResult.innerHTML = '';
    
    partialDiv = null;
    completedTranscriptions = [];
    completedTranslations = [];
    currentPartialText = '';
    
    // 감지된 언어 초기화
    detectedLanguage = null;
    languageConfidence = 0;
    updateDetectedLanguageDisplay();
    
    if (forcedUpdateTimer) {
        clearInterval(forcedUpdateTimer);
        forcedUpdateTimer = null;
    }
}

// 녹음 중지 함수
function stopRecording() {
    if (!isRecording) return;
    
    updateStatus("중지 버튼이 클릭되었습니다.");
    
    isRecording = false;
    socket.emit('stop_recording');
    
    // 오디오 처리 중지
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        if (audioAnalyser) audioAnalyser.disconnect();
        if (source) source.disconnect();
        scriptProcessor = null;
        audioAnalyser = null;
        source = null;
    }
    
    // AudioContext 중지
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }
    
    // 타이머 중지
    if (forcedUpdateTimer) {
        clearInterval(forcedUpdateTimer);
        forcedUpdateTimer = null;
    }
    
    // 오디오 시각화 중지
    stopAudioVisualization();
    
    // 버튼 상태 업데이트
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
    
    // 녹음 상태 표시 업데이트
    const statusDiv = document.querySelector('.recording-status');
    if (statusDiv) {
        statusDiv.textContent = '녹음이 중지되었습니다.';
        statusDiv.style.color = 'green';
    }
    
    updateStatus("녹음이 중지되었습니다.");
    
    // 진행 중인 텍스트 완료 처리
    if (partialDiv) {
        partialDiv.classList.remove('partial');
        partialDiv.classList.add('completed');
        partialDiv = null;
    }
}

// 텍스트 유사도 확인
function getTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;
    
    if (text1.includes(text2)) {
        return text2.length / text1.length;
    }
    if (text2.includes(text1)) {
        return text1.length / text2.length;
    }
    
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    
    const commonWords = words1.filter(word => words2.includes(word));
    
    return commonWords.length / (words1.length + words2.length - commonWords.length);
}

// 중복 텍스트 감지
function isDuplicate(text, collection, threshold = 0.85) {
    for (const item of collection) {
        const similarity = getTextSimilarity(text, item);
        if (similarity > threshold) {
            return true;
        }
    }
    return false;
}

// 텍스트 청크 생성 함수
function createTextChunk(text, isPartial = false, container) {
    if (!container) return null;
    
    const div = document.createElement('div');
    div.className = `text-item ${isPartial ? 'partial' : 'completed'}`;
    div.textContent = text;
    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
    return div;
}

// 초기화 함수
function initialize() {
    // 버튼에 이벤트 리스너 추가
    if (startButton) startButton.addEventListener('click', startRecording);
    if (stopButton) stopButton.addEventListener('click', stopRecording);
    
    // 언어 컨트롤 설정
    setupLanguageControls();
    
    // 초기 버튼 상태 설정
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
    
    // 결과 초기화
    clearResults();
    
    // 로그 컨테이너 초기화
    clearLogContainer();
    
    // 오디오 시각화 초기화
    initAudioVisualization();
    
    // 내보내기 기능 초기화
    initExportFeatures();
    
    updateStatus("초기화 완료. 녹음을 시작할 준비가 되었습니다.");
}

// Socket.IO 이벤트 핸들러
socket.on('connect', () => {
    updateStatus("서버에 연결되었습니다.");
});

socket.on('disconnect', () => {
    updateStatus("서버와 연결이 끊어졌습니다.", true);
    
    if (isRecording) {
        stopRecording();
    }
});

socket.on('partial_transcription', (data) => {
    const newText = data.text.trim();
    const isContinuous = data.continuous || false;  // 서버에서 보낸 연속성 정보
    lastUpdateTime = Date.now();
    
    if (newText === currentPartialText) {
        return;
    }
    
    console.log("부분 인식:", newText, isContinuous ? "(연속)" : "(새 텍스트)");
    
    // 중복 확인을 더 엄격하게
    if (isDuplicate(newText, completedTranscriptions, 0.9)) {
        console.log("부분 인식 무시 (중복):", newText);
        return;
    }
    
    // 너무 짧은 텍스트는 무시 (3단어 미만)
    if (newText.split(/\s+/).length < 3) {
        return;
    }
    
    // 연속 텍스트 처리를 위한 핵심 로직
    // 이전 청크가 새 청크에 온전히 포함되면 자연스럽게 업데이트
    const shouldPreserveContext = currentPartialText && 
                                    (newText.includes(currentPartialText) || 
                                    getTextSimilarity(currentPartialText, newText) > 0.5);
    
    currentPartialText = newText;
    
    if (!partialDiv) {
        // 새 부분 텍스트 요소 생성
        partialDiv = createTextChunk(newText, true, transcriptionResult);
    } else if (shouldPreserveContext || isContinuous) {
        // 문맥 유지 모드: 내용만 업데이트
        partialDiv.textContent = newText;
        partialDiv.classList.add('continuous');  // 연속 텍스트 스타일
        partialDiv.scrollIntoView({ behavior: 'smooth' });
    } else {
        // 완전 새 텍스트: 이전 부분 텍스트를 완료 상태로 변경하고 새로 시작
        partialDiv.classList.remove('partial');
        partialDiv.classList.add('completed');
        
        // 새 부분 텍스트 생성
        partialDiv = createTextChunk(newText, true, transcriptionResult);
    }
});

// FIXED: 번역 결과 처리 시 서버에서 source_language, target_language 속성이 오지 않는 문제 수정
socket.on('translation', (data) => {
    const transcriptText = data.text.trim();
    const translationText = data.translation.trim();
    
    // 서버에서 전송되지 않는 속성들에 대한 참조 제거
    // source_language와 target_language 대신 전역 변수 사용
    const sourceLanguage = detectedLanguage || currentSourceLanguage;
    const targetLanguage = currentTargetLanguage;
    
    lastUpdateTime = Date.now();
    
    console.log(`번역 결과: ${sourceLanguage} → ${targetLanguage}`, transcriptText, "->", translationText);
    
    if (isDuplicate(transcriptText, completedTranscriptions)) {
        console.log("번역 무시 (원본 중복):", transcriptText);
        return;
    }
    
    if (isDuplicate(translationText, completedTranslations)) {
        console.log("번역 무시 (번역 중복):", translationText);
        return;
    }
    
    if (partialDiv && getTextSimilarity(currentPartialText, transcriptText) > 0.7) {
        partialDiv.remove();
        partialDiv = null;
    } else if (partialDiv) {
        partialDiv.classList.remove('partial');
        partialDiv.classList.add('completed');
        completedTranscriptions.push(partialDiv.textContent);
        partialDiv = null;
    }
    
    const hasOverlap = (completedTranscriptions.length > 0) && 
                        transcriptText.startsWith(completedTranscriptions[completedTranscriptions.length - 1]);
    
    completedTranscriptions.push(transcriptText);
    completedTranslations.push(translationText);
    
    let displayText = transcriptText;
    if (hasOverlap) {
        const prevText = completedTranscriptions[completedTranscriptions.length - 2];
        displayText = transcriptText.substring(prevText.length).trim();
        
        if (displayText.length < 5) {
            return;
        }
    }
    
    const transcriptDiv = createTextChunk(displayText, false, transcriptionResult);
    const translationDiv = createTextChunk(translationText, false, translationResult);
    
    // 추가: 언어 정보 표시 (선택적)
    if (sourceLanguage !== targetLanguage) {
        const langInfo = document.createElement('div');
        langInfo.className = 'lang-info';
        langInfo.textContent = `${supportedLanguages[sourceLanguage]?.name || sourceLanguage} → ${supportedLanguages[targetLanguage]?.name || targetLanguage}`;
        langInfo.style.fontSize = '0.8em';
        langInfo.style.color = '#888';
        langInfo.style.marginTop = '4px';
        
        translationDiv.appendChild(langInfo);
    }
});

// 언어 감지 이벤트 처리
socket.on('detected_language', (data) => {
    console.log("감지된 언어:", data);
    
    // FIXED: 안전성 체크 추가
    if (data && data.language_code && isAutoDetectEnabled) {
        detectedLanguage = data.language_code;
        languageConfidence = data.confidence || 0.7;
        
        // 언어 감지 표시 업데이트
        updateDetectedLanguageDisplay();
    }
});

socket.on('error', (errorMessage) => {
    updateStatus(`서버 오류: ${errorMessage}`, true);
});

socket.on('logger', (logMessage) => {
    if (!logContainer) return;
    
    const logDiv = document.createElement('div');
    logDiv.textContent = logMessage;
    logDiv.style.color = '#888';
    logDiv.style.fontSize = '0.9em';
    logContainer.appendChild(logDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
});

// FIXED: 내보내기 기능 초기화에 안전성 체크 추가
function initExportFeatures() {
    // 버튼 엘리먼트 가져오기
    exportTextBtn = document.getElementById('exportText');
    exportWordBtn = document.getElementById('exportWord');
    exportPDFBtn = document.getElementById('exportPDF');
    exportHTMLBtn = document.getElementById('exportHTML');
    copyToClipboardBtn = document.getElementById('copyToClipboard');
    
    // 필요한 요소가 없으면 초기화 취소
    if (!exportTextBtn) {
        console.warn("내보내기 버튼 요소를 찾을 수 없습니다.");
        return;
    }
    
    // 옵션 체크박스 엘리먼트 가져오기
    exportOriginalCheck = document.getElementById('exportOriginal');
    exportTranslationCheck = document.getElementById('exportTranslation');
    exportTimestampCheck = document.getElementById('exportTimestamp');
    exportLanguageInfoCheck = document.getElementById('exportLanguageInfo');
    
    if (!exportOriginalCheck || !exportTranslationCheck) {
        console.warn("내보내기 옵션 요소를 찾을 수 없습니다.");
        return;
    }
    
    // 옵션 변경 이벤트 리스너
    exportOriginalCheck.addEventListener('change', function() {
        exportOptions.original = this.checked;
    });
    
    exportTranslationCheck.addEventListener('change', function() {
        exportOptions.translation = this.checked;
    });
    
    exportTimestampCheck.addEventListener('change', function() {
        exportOptions.timestamp = this.checked;
    });
    
    exportLanguageInfoCheck.addEventListener('change', function() {
        exportOptions.languageInfo = this.checked;
    });
    
    // 내보내기 버튼 이벤트 리스너 (외부 라이브러리 체크 추가)
    exportTextBtn.addEventListener('click', exportAsText);
    
    // FIXED: 외부 라이브러리 존재 여부 확인
    if (typeof docx !== 'undefined') {
        exportWordBtn.addEventListener('click', exportAsWord);
    } else {
        exportWordBtn.addEventListener('click', () => showNotification('DOCX 라이브러리가 로드되지 않았습니다.', true));
        exportWordBtn.classList.add('disabled');
    }
    
    if (typeof jspdf !== 'undefined') {
        exportPDFBtn.addEventListener('click', exportAsPDF);
    } else {
        exportPDFBtn.addEventListener('click', () => showNotification('PDF 라이브러리가 로드되지 않았습니다.', true));
        exportPDFBtn.classList.add('disabled');
    }
    
    exportHTMLBtn.addEventListener('click', exportAsHTML);
    copyToClipboardBtn.addEventListener('click', copyToClipboard);
}

// 번역 목록 가져오기
function getTranslationData() {
    // 히스토리가 비어있으면 알림 표시
    if (completedTranscriptions.length === 0) {
        showNotification('내보낼 번역 결과가 없습니다.', true);
        return null;
    }
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    // 번역 데이터 객체 생성
    const data = {
        items: [],
        timestamp: timestamp,
        sourceLanguage: detectedLanguage || currentSourceLanguage,
        targetLanguage: currentTargetLanguage,
        detectedLanguage: detectedLanguage
    };
    
    // completedTranscriptions와 completedTranslations에서 데이터 수집
    for (let i = 0; i < completedTranscriptions.length; i++) {
        if (i < completedTranslations.length) {
            data.items.push({
                original: completedTranscriptions[i],
                translation: completedTranslations[i],
                index: i + 1
            });
        }
    }
    
    return data;
}

// 날짜 시간을 파일명에 적합한 형식으로 변환
function getFormattedDateTime() {
    const now = new Date();
    return `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
}

// 파일명 생성 함수
function getFileName(extension) {
    const datetime = getFormattedDateTime();
    const sourceLang = detectedLanguage || currentSourceLanguage;
    const targetLang = currentTargetLanguage;
    
    let sourceCode = sourceLang.split('_')[0];
    let targetCode = targetLang.split('_')[0];
    
    return `translation_${sourceCode}-${targetCode}_${datetime}.${extension}`;
}

// 텍스트 파일로 내보내기
function exportAsText() {
    const data = getTranslationData();
    if (!data) return;
    
    setButtonLoading(exportTextBtn, true);
    
    try {
        let content = '';
        
        // 헤더 정보
        content += `번역 결과 (${data.timestamp})\n`;
        content += `${'='.repeat(50)}\n\n`;
        
        // 언어 정보
        if (exportOptions.languageInfo) {
            const srcLang = supportedLanguages[data.sourceLanguage] ? supportedLanguages[data.sourceLanguage].name : data.sourceLanguage;
            const tgtLang = supportedLanguages[data.targetLanguage] ? supportedLanguages[data.targetLanguage].name : data.targetLanguage;
            
            content += `원본 언어: ${srcLang}\n`;
            content += `번역 언어: ${tgtLang}\n\n`;
            
            if (data.detectedLanguage && data.detectedLanguage !== data.sourceLanguage) {
                const detectedLang = supportedLanguages[data.detectedLanguage] ? supportedLanguages[data.detectedLanguage].name : data.detectedLanguage;
                content += `감지된 언어: ${detectedLang}\n\n`;
            }
        }
        
        // 번역 내용
        data.items.forEach((item, index) => {
            if (exportOptions.timestamp) {
                content += `[${index + 1}] `;
            }
            
            if (exportOptions.original) {
                content += `원본: ${item.original}\n`;
            }
            
            if (exportOptions.translation) {
                content += `번역: ${item.translation}\n`;
            }
            
            content += '\n';
        });
        
        // FIXED: saveAs 함수 존재 확인
        if (typeof saveAs === 'undefined') {
            throw new Error('FileSaver.js 라이브러리가 로드되지 않았습니다');
        }
        
        // 파일 생성 및 다운로드
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const fileName = getFileName('txt');
        saveAs(blob, fileName);
        
        showNotification('텍스트 파일로 내보내기 완료!');
    } catch (error) {
        console.error('텍스트 내보내기 오류:', error);
        showNotification('텍스트 파일 생성 중 오류가 발생했습니다: ' + error.message, true);
    } finally {
        setButtonLoading(exportTextBtn, false);
    }
}

// FIXED: Word 문서로 내보내기 (안전성 체크 추가)
function exportAsWord() {
    const data = getTranslationData();
    if (!data) return;
    
    // docx 라이브러리 체크
    if (typeof docx === 'undefined') {
        showNotification('DOCX 라이브러리가 로드되지 않았습니다.', true);
        return;
    }
    
    setButtonLoading(exportWordBtn, true);
    
    try {
        // docx 라이브러리 사용
        const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;
        
        // 새 문서 생성
        const doc = new Document({
            sections: [{
                properties: {},
                children: []
            }]
        });
        
        // 문서 제목 추가
        doc.addSection({
            children: [
                new Paragraph({
                    text: `번역 결과`,
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER
                }),
                new Paragraph({
                    text: data.timestamp,
                    alignment: AlignmentType.CENTER
                }),
                new Paragraph({
                    text: '',
                    spacing: { after: 200 }
                })
            ]
        });
        
        // 언어 정보 추가
        if (exportOptions.languageInfo) {
            const srcLang = supportedLanguages[data.sourceLanguage] ? supportedLanguages[data.sourceLanguage].name : data.sourceLanguage;
            const tgtLang = supportedLanguages[data.targetLanguage] ? supportedLanguages[data.targetLanguage].name : data.targetLanguage;
            
            const langInfo = [
                new Paragraph({
                    text: `원본 언어: ${srcLang}`,
                    spacing: { after: 100 }
                }),
                new Paragraph({
                    text: `번역 언어: ${tgtLang}`,
                    spacing: { after: 100 }
                })
            ];
            
            if (data.detectedLanguage && data.detectedLanguage !== data.sourceLanguage) {
                const detectedLang = supportedLanguages[data.detectedLanguage] ? supportedLanguages[data.detectedLanguage].name : data.detectedLanguage;
                langInfo.push(
                    new Paragraph({
                        text: `감지된 언어: ${detectedLang}`,
                        spacing: { after: 200 }
                    })
                );
            } else {
                langInfo.push(
                    new Paragraph({
                        text: '',
                        spacing: { after: 200 }
                    })
                );
            }
            
            doc.addSection({ children: langInfo });
        }
        
        // 번역 내용 추가
        const contentChildren = [];
        
        data.items.forEach((item, index) => {
            const paragraphs = [];
            
            if (exportOptions.timestamp) {
                paragraphs.push(
                    new Paragraph({
                        text: `항목 ${index + 1}`,
                        heading: HeadingLevel.HEADING_2,
                        spacing: { after: 100 }
                    })
                );
            }
            
            if (exportOptions.original) {
                paragraphs.push(
                    new Paragraph({
                        text: '원본:',
                        spacing: { after: 100 }
                    }),
                    new Paragraph({
                        text: item.original,
                        spacing: { after: 200 }
                    })
                );
            }
            
            if (exportOptions.translation) {
                paragraphs.push(
                    new Paragraph({
                        text: '번역:',
                        spacing: { after: 100 }
                    }),
                    new Paragraph({
                        text: item.translation,
                        spacing: { after: 300 }
                    })
                );
            }
            
            contentChildren.push(...paragraphs);
        });
        
        doc.addSection({ children: contentChildren });
        
        // FIXED: saveAs 함수 존재 확인
        if (typeof saveAs === 'undefined') {
            throw new Error('FileSaver.js 라이브러리가 로드되지 않았습니다');
        }
        
        // 문서 생성 및 다운로드
        Packer.toBlob(doc).then(blob => {
            const fileName = getFileName('docx');
            saveAs(blob, fileName);
            showNotification('Word 문서로 내보내기 완료!');
            setButtonLoading(exportWordBtn, false);
        }).catch(error => {
            throw error;
        });
        
    } catch (error) {
        console.error('Word 내보내기 오류:', error);
        showNotification('Word 문서 생성 중 오류가 발생했습니다: ' + error.message, true);
        setButtonLoading(exportWordBtn, false);
    }
}

// FIXED: PDF 문서로 내보내기 (안전성 체크 추가)
function exportAsPDF() {
    const data = getTranslationData();
    if (!data) return;
    
    // jsPDF 라이브러리 체크
    if (typeof jspdf === 'undefined') {
        showNotification('PDF 라이브러리가 로드되지 않았습니다.', true);
        return;
    }
    
    setButtonLoading(exportPDFBtn, true);
    
    try {
        // jsPDF 라이브러리 사용
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // 기본 설정
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        const contentWidth = pageWidth - (margin * 2);
        let y = margin;
        
        // 한글 지원 폰트 추가 (한글 지원 폰트가 필요함)
        doc.setFont('helvetica');
        doc.setFontSize(16);
        
        // 제목
        doc.text('번역 결과', pageWidth / 2, y, { align: 'center' });
        y += 10;
        
        doc.setFontSize(10);
        doc.text(data.timestamp, pageWidth / 2, y, { align: 'center' });
        y += 15;
        
        // 언어 정보
        if (exportOptions.languageInfo) {
            doc.setFontSize(12);
            
            const srcLang = supportedLanguages[data.sourceLanguage] ? supportedLanguages[data.sourceLanguage].name : data.sourceLanguage;
            const tgtLang = supportedLanguages[data.targetLanguage] ? supportedLanguages[data.targetLanguage].name : data.targetLanguage;
            
            doc.text(`원본 언어: ${srcLang}`, margin, y);
            y += 7;
            doc.text(`번역 언어: ${tgtLang}`, margin, y);
            y += 7;
            
            if (data.detectedLanguage && data.detectedLanguage !== data.sourceLanguage) {
                const detectedLang = supportedLanguages[data.detectedLanguage] ? supportedLanguages[data.detectedLanguage].name : data.detectedLanguage;
                doc.text(`감지된 언어: ${detectedLang}`, margin, y);
                y += 7;
            }
            
            y += 8;
        }
        
        // 번역 내용
        doc.setFontSize(12);
        
        data.items.forEach((item, index) => {
            // 페이지 여백 확인
            if (y > doc.internal.pageSize.getHeight() - 30) {
                doc.addPage();
                y = margin;
            }
            
            if (exportOptions.timestamp) {
                doc.setFontSize(14);
                doc.text(`항목 ${index + 1}`, margin, y);
                y += 8;
                doc.setFontSize(12);
            }
            
            if (exportOptions.original) {
                doc.setFont('helvetica', 'bold');
                doc.text('원본:', margin, y);
                y += 7;
                
                doc.setFont('helvetica', 'normal');
                const originalLines = doc.splitTextToSize(item.original, contentWidth);
                doc.text(originalLines, margin, y);
                y += (originalLines.length * 7) + 5;
            }
            
            if (exportOptions.translation) {
                // 페이지 여백 확인
                if (y > doc.internal.pageSize.getHeight() - 40) {
                    doc.addPage();
                    y = margin;
                }
                
                doc.setFont('helvetica', 'bold');
                doc.text('번역:', margin, y);
                y += 7;
                
                doc.setFont('helvetica', 'normal');
                const translationLines = doc.splitTextToSize(item.translation, contentWidth);
                doc.text(translationLines, margin, y);
                y += (translationLines.length * 7) + 10;
            }
        });
        
        // 파일 다운로드
        const fileName = getFileName('pdf');
        doc.save(fileName);
        
        showNotification('PDF 문서로, 내보내기 완료!');
    } catch (error) {
        console.error('PDF 내보내기 오류:', error);
        showNotification('PDF 생성 중 오류가 발생했습니다: ' + error.message, true);
    } finally {
        setButtonLoading(exportPDFBtn, false);
    }
}

// HTML로 내보내기
function exportAsHTML() {
    const data = getTranslationData();
    if (!data) return;
    
    setButtonLoading(exportHTMLBtn, true);
    
    try {
        // HTML 콘텐츠 생성
        let html = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>번역 결과 - ${data.timestamp}</title>
            <style>
                body {
                    font-family: 'Segoe UI', Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                }
                h1 {
                    text-align: center;
                    color: #2b6cb0;
                    margin-bottom: 10px;
                }
                .timestamp {
                    text-align: center;
                    color: #718096;
                    margin-bottom: 30px;
                    font-size: 0.9em;
                }
                .language-info {
                    background-color: #f7fafc;
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 30px;
                }
                .translation-item {
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid #e2e8f0;
                }
                .item-header {
                    font-weight: bold;
                    font-size: 1.1em;
                    color: #4a5568;
                    margin-bottom: 10px;
                }
                .item-label {
                    font-weight: bold;
                    color: #4a5568;
                    margin-bottom: 5px;
                }
                .original-text {
                    margin-bottom: 15px;
                    padding: 10px;
                    background-color: #f8fafc;
                    border-left: 3px solid #4299e1;
                    border-radius: 3px;
                }
                .translation-text {
                    padding: 10px;
                    background-color: #f0fff4;
                    border-left: 3px solid #48bb78;
                    border-radius: 3px;
                }
                footer {
                    margin-top: 50px;
                    text-align: center;
                    font-size: 0.8em;
                    color: #a0aec0;
                }
            </style>
        </head>
        <body>
            <h1>번역 결과</h1>
            <div class="timestamp">${data.timestamp}</div>
        `;
        
        // 언어 정보 추가
        if (exportOptions.languageInfo) {
            const srcLang = supportedLanguages[data.sourceLanguage] ? supportedLanguages[data.sourceLanguage].name : data.sourceLanguage;
            const tgtLang = supportedLanguages[data.targetLanguage] ? supportedLanguages[data.targetLanguage].name : data.targetLanguage;
            
            html += `<div class="language-info">`;
            html += `<div>원본 언어: ${srcLang}</div>`;
            html += `<div>번역 언어: ${tgtLang}</div>`;
            
            if (data.detectedLanguage && data.detectedLanguage !== data.sourceLanguage) {
                const detectedLang = supportedLanguages[data.detectedLanguage] ? supportedLanguages[data.detectedLanguage].name : data.detectedLanguage;
                html += `<div>감지된 언어: ${detectedLang}</div>`;
            }
            
            html += `</div>`;
        }
        
        // 번역 내용 추가
        data.items.forEach((item, index) => {
            html += `<div class="translation-item">`;
            
            if (exportOptions.timestamp) {
                html += `<div class="item-header">항목 ${index + 1}</div>`;
            }
            
            if (exportOptions.original) {
                html += `<div class="item-label">원본:</div>`;
                html += `<div class="original-text">${escapeHTML(item.original)}</div>`;
            }
            
            if (exportOptions.translation) {
                html += `<div class="item-label">번역:</div>`;
                html += `<div class="translation-text">${escapeHTML(item.translation)}</div>`;
            }
            
            html += `</div>`;
        });
        
        // 푸터 추가
        html += `
            <footer>
                <p>이 문서는 실시간 음성 번역 서비스에서 생성되었습니다.</p>
            </footer>
        </body>
        </html>
        `;
        
        // FIXED: saveAs 함수 존재 확인
        if (typeof saveAs === 'undefined') {
            throw new Error('FileSaver.js 라이브러리가 로드되지 않았습니다');
        }
        
        // 파일 생성 및 다운로드
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const fileName = getFileName('html');
        saveAs(blob, fileName);
        
        showNotification('HTML 파일로 내보내기 완료!');
    } catch (error) {
        console.error('HTML 내보내기 오류:', error);
        showNotification('HTML 파일 생성 중 오류가 발생했습니다: ' + error.message, true);
    } finally {
        setButtonLoading(exportHTMLBtn, false);
    }
}

// 클립보드로 복사
function copyToClipboard() {
    const data = getTranslationData();
    if (!data) return;
    
    setButtonLoading(copyToClipboardBtn, true);
    
    try {
        let content = '';
        
        // 헤더 정보
        content += `번역 결과 (${data.timestamp})\n\n`;
        
        // 언어 정보
        if (exportOptions.languageInfo) {
            const srcLang = supportedLanguages[data.sourceLanguage] ? supportedLanguages[data.sourceLanguage].name : data.sourceLanguage;
            const tgtLang = supportedLanguages[data.targetLanguage] ? supportedLanguages[data.targetLanguage].name : data.targetLanguage;
            
            content += `원본 언어: ${srcLang}\n`;
            content += `번역 언어: ${tgtLang}\n`;
            
            if (data.detectedLanguage && data.detectedLanguage !== data.sourceLanguage) {
                const detectedLang = supportedLanguages[data.detectedLanguage] ? supportedLanguages[data.detectedLanguage].name : data.detectedLanguage;
                content += `감지된 언어: ${detectedLang}\n`;
            }
            
            content += '\n';
        }
        
        // 번역 내용
        data.items.forEach((item, index) => {
            if (exportOptions.timestamp) {
                content += `[${index + 1}] `;
            }
            
            if (exportOptions.original) {
                content += `원본: ${item.original}\n`;
            }
            
            if (exportOptions.translation) {
                content += `번역: ${item.translation}\n`;
            }
            
            content += '\n';
        });
        
        // FIXED: navigator.clipboard 지원 확인
        if (!navigator.clipboard) {
            throw new Error('클립보드 API가 지원되지 않는 브라우저입니다');
        }
        
        // 클립보드에 복사
        navigator.clipboard.writeText(content).then(function() {
            showNotification('클립보드에 복사되었습니다!');
        }, function(err) {
            console.error('클립보드 복사 실패:', err);
            showNotification('클립보드 복사 중 오류가 발생했습니다: ' + err.message, true);
        });
    } catch (error) {
        console.error('클립보드 복사 오류:', error);
        showNotification('클립보드 복사 중 오류가 발생했습니다: ' + error.message, true);
    } finally {
        setButtonLoading(copyToClipboardBtn, false);
    }
}

// HTML 태그 이스케이프 함수
function escapeHTML(text) {
    if (!text) return '';
    
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 버튼 로딩 상태 표시
function setButtonLoading(button, isLoading) {
    if (!button) return;
    
    if (isLoading) {
        button.disabled = true;
        button.classList.add('loading');
        button.dataset.originalText = button.textContent;
        button.textContent = '';
    } else {
        button.disabled = false;
        button.classList.remove('loading');
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
    }
}

// 알림 표시
function showNotification(message, isError = false) {
    // 기존 알림 제거
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // 새 알림 생성
    const notification = document.createElement('div');
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.textContent = message;
    
    // 문서에 추가
    document.body.appendChild(notification);
    
    // 애니메이션 효과를 위해 약간 지연 후 보이기
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // 3초 후 알림 사라짐
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initialize);