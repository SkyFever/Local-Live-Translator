# app.py - 다국어 지원 추가

import os
import time
import numpy as np
import torch
import logging
from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO, emit
from faster_whisper import WhisperModel
from transformers import pipeline
from dotenv import load_dotenv
import re
import threading
import difflib
from dataclasses import dataclass, field
from typing import List
from collections import deque


load_dotenv()

# 로깅 설정
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    filename='server.log',
                    filemode='w',
                    encoding='utf-8',
                    force=True)

# root logger 가져오기
logger = logging.getLogger()
handler = logger.handlers[0]

app = Flask(__name__, static_folder='../client/public', static_url_path='/')
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'sk-test1234567890123456789012345678901234')

# 큰 바이너리 데이터 처리를 위한 설정
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32MB 제한
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', max_http_buffer_size=16*1024*1024)

# 언어 모델 초기화
print("Initializing Whisper Model...")
model_size = "large-v3-turbo"  # 고품질 모델 사용
model = WhisperModel(model_size, device="cuda", compute_type="float16", num_workers=8)
print("Whisper Model initialized!")

# 번역 모델 초기화
print("Initializing Translation Pipeline...")
translator = pipeline("translation", model="facebook/nllb-200-distilled-1.3B", device=torch.device("cuda"), torch_dtype=torch.bfloat16)
print("Translation Pipeline initialized!")

# 기존 FastText 모델 초기화 코드 대체
print("Initializing Language Detection...")
# langdetect 설정
try:
    from langdetect import DetectorFactory
    from langdetect import detect_langs
    from langdetect.lang_detect_exception import LangDetectException
    
    # 언어 감지 결과의 일관성을 위해 시드 설정
    DetectorFactory.seed = 0
    LANGDETECT_AVAILABLE = True
    print("langdetect 라이브러리가 초기화되었습니다.")
except ImportError:
    LANGDETECT_AVAILABLE = False
    print("langdetect 라이브러리를 찾을 수 없습니다. pip install langdetect로 설치해주세요.")

# 지원 언어 매핑 정의
LANGUAGE_MAPPING = {
    # 파이썬 코드 내에서 사용하는 언어 매핑
    # langdetect  코드 -> NLLB 코드 매핑
    "en": "eng_Latn",  # 영어
    "ko": "kor_Hang",  # 한국어
    "ja": "jpn_Jpan",  # 일본어
    "zh": "cmn_Hans",  # 중국어 간체
    "de": "deu_Latn",  # 독일어
    "fr": "fra_Latn",  # 프랑스어
    "es": "spa_Latn",  # 스페인어
    "ru": "rus_Cyrl",  # 러시아어
    "pt": "por_Latn",  # 포르투갈어
    "it": "ita_Latn",  # 이탈리아어
    "vi": "vie_Latn",  # 베트남어
    "th": "tha_Thai",  # 태국어
    "id": "ind_Latn",  # 인도네시아어
    "nl": "nld_Latn",  # 네덜란드어
    "tr": "tur_Latn",  # 터키어
    "ar": "ara_Arab",  # 아랍어
    "hi": "hin_Deva",  # 힌디어
}

# ISO 언어 코드 -> whisper 코드 매핑
WHISPER_LANGUAGE_MAPPING = {
    "en": "en",  # 영어
    "ko": "ko",  # 한국어
    "ja": "ja",  # 일본어
    "zh": "zh",  # 중국어
    "de": "de",  # 독일어
    "fr": "fr",  # 프랑스어
    "es": "es",  # 스페인어
    "ru": "ru",  # 러시아어
    "pt": "pt",  # 포르투갈어
    "it": "it",  # 이탈리아어
    "vi": "vi",  # 베트남어
    "th": "th",  # 태국어
    "id": "id",  # 인도네시아어
    "nl": "nl",  # 네덜란드어
    "tr": "tr",  # 터키어
    "ar": "ar",  # 아랍어
    "hi": "hi",  # 힌디어
}

# 언어 감지 함수 - langdetect 사용
def detect_language(text: str) -> tuple:
    """
    텍스트에서 언어를 감지하는 함수 (langdetect 사용)
    
    Args:
        text: 언어를 감지할 텍스트
        
    Returns:
        tuple: (감지된 언어 코드, 신뢰도)
    """
    if not text or len(text.strip()) < 10:  # 최소 10자 이상 필요
        return None, 0.0
    
    try:
        if not LANGDETECT_AVAILABLE:
            logger.warning("langdetect 라이브러리를 찾을 수 없습니다.")
            return "eng_Latn", 0.0
            
        # 언어 감지 수행 (최대 3개 언어 후보)
        detection = detect_langs(text)
        
        if not detection:
            logger.warning("언어 감지 결과가 없습니다.")
            return "eng_Latn", 0.0
            
        # 최상위 언어와 신뢰도
        top_lang = detection[0].lang
        top_confidence = float(detection[0].prob)
        
        logger.info(f"감지된 언어: {top_lang} (신뢰도: {top_confidence:.4f})")
        
        # NLLB 언어 코드로 변환
        nllb_lang = LANGUAGE_MAPPING.get(top_lang, "eng_Latn")  # 기본값은 영어
        
        # 신뢰도 임계값 적용 (0.5 미만은 신뢰할 수 없음)
        if top_confidence < 0.3:  # 임계값 낮춤 (0.5 → 0.3)
            logger.warning(f"언어 감지 신뢰도가 낮음: {top_confidence}")    # 신뢰도가 낮더라도 감지된 언어 사용
        
        return nllb_lang, top_confidence
        
    except LangDetectException as e:
        logger.exception(f"언어 감지 오류: {e}")
        return "eng_Latn", 0.0  # 오류 시 영어로 가정

@dataclass
class SentenceManager:
    """문장 관리 클래스"""
    sentences: List[str] = field(default_factory=list)
    current_sentence: str = ""
    pending_text: str = ""  # 아직 확정되지 않은 텍스트 저장
    last_update_time: float = 0.0
    threshold: float = 0.7  # 수정: 임계값 낮춤 (0.8 -> 0.7)
    max_wait_time: float = 4  # 수정: 시간 단축 (5초->4초)
    auto_send_threshold: int = 8  # 수정: 임계값 낮춤 (10->8)
    stability_counter: int = 0  # 텍스트 안정성 카운터
    last_stable_text: str = ""  # 안정적인 마지막 텍스트 저장
    
    def reset(self):
        self.sentences = []
        self.current_sentence = ""
        self.pending_text = ""
        self.stability_counter = 0
        self.last_stable_text = ""
        self.last_update_time = time.time()
    
    def is_text_stable(self, new_text: str) -> bool:
        """텍스트 안정성 확인 로직 - 더 정교하게 개선"""
        # 새 텍스트가 이전과 매우 유사한 경우
        if self.pending_text == new_text:
            self.stability_counter += 1
            
            # 3번 연속 같은 텍스트면 안정적으로 간주
            if self.stability_counter >= 3:
                self.last_stable_text = new_text
                return True
            return False
        
        # 일관된 확장인 경우 - 이전 텍스트에서 자연스럽게 추가됨
        if new_text.startswith(self.pending_text):
            added_chars = len(new_text) - len(self.pending_text)
            
            # 추가된 텍스트가 너무 많으면 불안정하다고 판단
            if added_chars > 40:
                self.stability_counter = 0
                self.pending_text = new_text
                return False
                
            # 적절한 추가라면 안정성 카운터 증가
            self.stability_counter += 1
            self.pending_text = new_text
            
            # 2회 이상 일관되게 증가했으면 안정적으로 간주
            if self.stability_counter >= 2:
                self.last_stable_text = new_text
                return True
            return False
        
        # 텍스트 유사도 계산 (새로운 추가)
        similarity = self._calculate_similarity(self.pending_text, new_text)
        
        # 유사도가 높은 경우에도 부분적으로 안정적으로 간주
        if similarity > 0.7:
            self.stability_counter += 1
            self.pending_text = new_text
            
            if self.stability_counter >= 2:
                self.last_stable_text = new_text
                return True
            return False
        
        # 완전히 다른 텍스트 - 안정성 초기화
        self.stability_counter = 0
        self.pending_text = new_text
        return False
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """두 텍스트 간의 유사도 계산"""
        if not text1 or not text2:
            return 0.0
        
        return difflib.SequenceMatcher(None, text1, text2).ratio()

# 세션 클래스 확장 - 언어 설정 추가
class SessionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
        self.timers = {}  # 세션별 타이머
    
    def create_session(self, session_id):
        """새 세션 생성"""
        with self.lock:
            self.sessions[session_id] = {
                'complete_text': "",
                'current_sentence': "",
                'is_recording': False,
                'audio_buffer': [],
                'last_processing_time': 0,
                'current_chunk': 0,
                'sent_texts': set(),
                'sent_translations': set(),
                'last_partial_update': 0,
                'partial_update_throttle': 0.2,
                'translation_history': [],
                'transcript_history': [],
                'buffer_reset_time': time.time(),
                'sentence_manager': SentenceManager(),
                'recent_audio_energy': deque(maxlen=10),
                'last_forced_process_time': 0,
                
                # 언어 관련 필드
                'source_language': 'eng_Latn',  # 기본 소스 언어: 영어
                'target_language': 'kor_Hang',  # 기본 타겟 언어: 한국어
                'auto_detect': True,            # 언어 자동 감지 기본값: 활성화
                'detected_language': None,      # 감지된 언어 코드
                'language_confidence': 0.0,     # 언어 감지 신뢰도
                'whisper_language': None,       # Whisper 모델용 언어 코드 (None=자동감지)

                # 음성 활동 감지 관련 필드
                'last_voice_activity_time': time.time(),
                'silence_duration': 0.0,
                'min_silence_for_processing': 2.5,  # 2.5초 이상 무음이면 문장 처리
                'speech_in_progress': False,
                'continuous_chunks_count': 0,  # 연속된 청크 수 카운터
                'last_chunk_had_content': False  # 마지막 청크에 내용이 있었는지
            }
            
            # 세션 타이머 시작 (문장 자동 처리용)
            self.start_session_timer(session_id)
            
            return self.sessions[session_id]
    
    def start_session_timer(self, session_id):
        """세션 타이머 시작 (2초마다 확인)"""
        def check_session():
            """세션 타이머 함수 - 현재 문장 처리 확인"""
            try:
                if session_id not in self.sessions:
                    return
                    
                session = self.sessions[session_id]
                if not session['is_recording']:
                    return
                
                # 현재 시간
                current_time = time.time()
                
                # 문장 관리자
                sentence_mgr = session['sentence_manager']
                
                # 발화가 진행 중이면 처리하지 않음
                if session['speech_in_progress']:
                    return
                
                # 마지막 음성 활동 후 충분한 시간이 지났는지 확인 (최소 4초)
                silence_duration = current_time - session['last_voice_activity_time']
                if silence_duration < 4.0:
                    return
                
                # 문장이 일정 시간 동안 업데이트되지 않았고, 충분히 길면 처리
                if sentence_mgr.current_sentence and current_time - sentence_mgr.last_update_time > 5.0:  # 5초 대기
                    logger.info(f"Auto processing text after timeout: {sentence_mgr.current_sentence}")
                    
                    # 문장 길이가 기준 이상이면 처리
                    word_count = len(sentence_mgr.current_sentence.split())
                    
                    # 최소 2단어 이상일 때 처리
                    if word_count >= 2:
                        translate_and_send(session_id, sentence_mgr.current_sentence, force_process=True)
                        # 처리 후 초기화
                        sentence_mgr.current_sentence = ""
                        sentence_mgr.last_update_time = current_time
                        sentence_mgr.stability_counter = 0
            except Exception as e:
                logger.exception(f"Error in timer function: {e}")
            finally:
                # 세션이 아직 존재하면 타이머 재설정
                with self.lock:
                    if session_id in self.sessions and self.sessions[session_id]['is_recording']:
                        self.timers[session_id] = threading.Timer(2.0, check_session)
                        self.timers[session_id].daemon = True
                        self.timers[session_id].start()
        
        # 최초 타이머 설정
        self.timers[session_id] = threading.Timer(2.0, check_session)
        self.timers[session_id].daemon = True
        self.timers[session_id].start()
    
    def stop_session_timer(self, session_id):
        """세션 타이머 정지"""
        if session_id in self.timers:
            self.timers[session_id].cancel()
            del self.timers[session_id]
    
    def get_session(self, session_id):
        """세션 가져오기"""
        with self.lock:
            if session_id not in self.sessions:
                return self.create_session(session_id)
            return self.sessions[session_id]
    
    def delete_session(self, session_id):
        """세션 삭제"""
        with self.lock:
            if session_id in self.sessions:
                # 타이머 정지
                self.stop_session_timer(session_id)
                # 세션 삭제
                del self.sessions[session_id]
    
    def update_session(self, session_id, key, value):
        """세션 값 업데이트"""
        with self.lock:
            if session_id in self.sessions:
                self.sessions[session_id][key] = value

# 세션 관리자 생성
session_manager = SessionManager()

# 오디오 처리 상태 관리
audio_processing_lock = threading.Lock()
min_processing_interval = 2.0  # 최소 처리 간격 (초)

# 오디오 버퍼 크기 설정
MAX_BUFFER_SIZE = 16000 * 5  # 2초 분량의 오디오 (16kHz)
MAX_BUFFER_AGE = 10  # 최대 버퍼 유지 시간 (초)

def is_sentence_end(text):
    """문장의 끝인지 판단하는 함수"""
    if not text:
        return False
    
    # 1. 명확한 문장 부호로 끝나는지 확인 (더 신중하게 체크)
    if re.search(r'[.!?][\s"\']*$', text):
        # 추가: 최소 단어 수 체크 (너무 짧은 문장은 끝으로 간주하지 않음)
        if len(text.split()) >= 5:
            return True
        return False  # 짧은 문장은 더 내용이 이어질 수 있음
    
    # 2. 쉼표나 콜론으로 끝나면 특별한 조건에서만 문장으로 간주
    if re.search(r'[,:][\s"\']*$', text):
        # 단어 수가 충분히 많아야 문장으로 간주
        if len(text.split()) > 12:  # 단어 수 임계값 증가
            return True
    
    # 3. 단어 수만으로 문장 끝 판단 (매우 긴 문장인 경우)
    if len(text.split()) > 20:  # 단어 수 임계값 크게 증가
        # 접속사로 끝나지 않는지 체크 (한국어, 영어 모두 고려)
        last_word = text.split()[-1].lower()
        korean_conjunctions = {'그리고', '또한', '하지만', '그러나', '또는', '혹은', '왜냐하면', '때문에', '만약', '비록'}
        english_conjunctions = {'and', 'or', 'but', 'because', 'while', 'if', 'unless', 'although', 'since', 'when', 'as', 'while'}
        
        # 접속사로 끝나면 문장이 더 이어질 가능성이 높음
        if last_word not in korean_conjunctions and last_word not in english_conjunctions:
            return True
    
    # 기본적으로 문장 경계가 아님
    return False

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def segments_to_text(segments, source_lang=None, min_confidence=0.6):
    """
    음성 인식 결과 후처리 함수
    
    Args:
        segments: Whisper 모델이 반환한 세그먼트
        source_lang: 원본 언어 코드 
        min_confidence: 최소 신뢰도 임계값
    
    Returns:
        str: 후처리된 텍스트
    """
    if not segments:
        return ""
    
    # 세그먼트 신뢰도 필터링
    reliable_segments = []
    for segment in segments:
        # 세그먼트 신뢰도 확인
        if hasattr(segment, 'avg_logprob') and segment.avg_logprob < -1.0:
            continue  # 신뢰도가 낮은 세그먼트 무시
        
        # 너무 짧은 세그먼트 무시 (노이즈일 가능성)
        if len(segment.text.strip()) < 2:
            continue
            
        reliable_segments.append(segment)
    
    # 신뢰할 수 있는 세그먼트가 없으면 빈 문자열 반환
    if not reliable_segments:
        return ""
    
    # 텍스트 추출 및 언어별 특화 처리
    texts = []
    for segment in reliable_segments:
        text = segment.text.strip()
        
        # 반복 단어 제거 (스터터링 효과 제거)
        text = remove_stuttering(text)
                
        if text:
            texts.append(text)
    
    # 세그먼트 결합
    result = " ".join(texts)
    
    # 일반적인 텍스트 정리
    result = clean_text(result)
    
    return result

def remove_stuttering(text):
    """반복 단어 제거 (스터터링 효과)"""
    if not text:
        return text
        
    words = text.split()
    if len(words) <= 3:
        return text
        
    # 같은 단어가 연속으로 나오는 경우 하나만 유지
    result = []
    for i, word in enumerate(words):
        if i > 0 and word.lower() == words[i-1].lower():
            continue
        result.append(word)
    
    return " ".join(result)

@socketio.on('connect')
def handle_connect():
    session_id = request.sid
    session_manager.create_session(session_id)
    logger.info(f'Client connected: {session_id}')
    emit("logger", "server: Client connected")

@socketio.on('disconnect')
def handle_disconnect():
    session_id = request.sid
    session_manager.delete_session(session_id)
    logger.info(f'Client disconnected: {session_id}')
    emit("logger", "server: Client disconnected")

# 언어 설정 업데이트 이벤트 핸들러
@socketio.on('update_language_config')
def handle_language_config(config):
    """언어 설정 업데이트 처리"""
    session_id = request.sid
    session = session_manager.get_session(session_id)
    
    logger.info(f"언어 설정 업데이트 요청: {config}")
    
    # 소스 언어 설정
    if 'sourceLanguage' in config:
        src_lang = config['sourceLanguage']
        if src_lang == 'auto':
            session['auto_detect'] = True
            # 감지된 언어 초기화
            session['detected_language'] = None
            session['language_confidence'] = 0.0
            session['whisper_language'] = None  # 자동 감지로 설정
        else:
            session['source_language'] = src_lang
            session['auto_detect'] = False  # 수동 선택 시 자동 감지 비활성화
            
            # Whisper 언어 코드 업데이트
            lang_code = next((k for k, v in LANGUAGE_MAPPING.items() if v == src_lang), 'en')
            session['whisper_language'] = WHISPER_LANGUAGE_MAPPING.get(lang_code, 'en')
    
    # 타겟 언어 설정
    if 'targetLanguage' in config:
        session['target_language'] = config['targetLanguage']
    
    # 자동 감지 설정
    if 'autoDetect' in config:
        session['auto_detect'] = config['autoDetect']
        if not config['autoDetect'] and 'sourceLanguage' in config and config['sourceLanguage'] != 'auto':
            # 자동 감지가 꺼지면, 소스 언어를 명시적으로 설정
            session['source_language'] = config['sourceLanguage']
            
            # Whisper 언어 코드 업데이트
            lang_code = next((k for k, v in LANGUAGE_MAPPING.items() if v == config['sourceLanguage']), 'en')
            session['whisper_language'] = WHISPER_LANGUAGE_MAPPING.get(lang_code, 'en')
    
    logger.info(f"언어 설정 업데이트 완료: source={session['source_language']}, " +
               f"target={session['target_language']}, auto_detect={session['auto_detect']}, " + 
               f"whisper_language={session['whisper_language']}")
    
    emit("logger", f"server: 언어 설정 업데이트됨 (소스: {session['source_language']}, 타겟: {session['target_language']}, 자동감지: {session['auto_detect']})", room=session_id)

@socketio.on('start_recording')
def handle_start_recording():
    session_id = request.sid
    session = session_manager.get_session(session_id)
    
    # 세션 초기화
    session['complete_text'] = ""
    session['current_sentence'] = ""
    session['audio_buffer'] = []
    session['is_recording'] = True
    session['current_chunk'] = 0
    session['sent_texts'] = set()
    session['sent_translations'] = set()
    session['translation_history'] = []
    session['transcript_history'] = []
    session['buffer_reset_time'] = time.time()
    session['sentence_manager'].reset()
    session['recent_audio_energy'] = deque(maxlen=10)
    session['last_forced_process_time'] = time.time()
    session['last_voice_activity_time'] = time.time()
    session['silence_duration'] = 0.0
    session['speech_in_progress'] = False
    session['continuous_chunks_count'] = 0
    session['last_chunk_had_content'] = False
    session['last_processed_text'] = ""  # 마지막 처리 텍스트 기록 초기화
    
    # 언어 감지 초기화
    session['detected_language'] = None
    session['language_confidence'] = 0.0
    
    logger.info(f"Start recording: {session_id}")
    emit("logger", "server: Start recording")

@socketio.on('chunk_number')
def handle_chunk_number(chunk_number):
    """청크 번호 수신 이벤트"""
    session_id = request.sid
    session = session_manager.get_session(session_id)
    session['current_chunk'] = chunk_number

@socketio.on('force_process')
def handle_force_process(data):
    """강제 처리 요청 처리"""
    session_id = request.sid
    session = session_manager.get_session(session_id)
    
    if not session['is_recording']:
        return
    
    # 마지막 강제 처리 이후 최소 0.8초는 경과해야 함
    current_time = time.time()
    if current_time - session['last_forced_process_time'] < 0.8:
        return
        
    # 강제 처리 시간 업데이트
    session['last_forced_process_time'] = current_time
    
    # 발화 진행 중 플래그 초기화 (사용자가 강제로 처리 요청했으므로)
    session['speech_in_progress'] = False
    session['last_chunk_had_content'] = False
    session['silence_duration'] = session['min_silence_for_processing'] + 0.5  # 무음 기간 충분히 설정
    
    # 현재 문장이 있으면 번역 처리 (길이 제한 완화)
    sentence_mgr = session['sentence_manager']
    if sentence_mgr.current_sentence and len(sentence_mgr.current_sentence) >= 5:
        logger.info(f"Forced processing text: {sentence_mgr.current_sentence}")
        translate_and_send(session_id, sentence_mgr.current_sentence)
        sentence_mgr.current_sentence = ""
        sentence_mgr.last_update_time = current_time
    
    logger.info("Force processing completed")

@socketio.on('audio_chunk')
def handle_audio(audio_data):
    session_id = request.sid
    session = session_manager.get_session(session_id)
    
    if not session['is_recording']:
        logger.info("Received audio but not recording")
        return
    
    try:
        # ArrayBuffer를 numpy 배열로 변환 (바이너리 데이터 직접 처리)
        float_data = np.frombuffer(audio_data, dtype=np.float32)
        
        # 오디오 버퍼에 추가
        session['audio_buffer'].extend(float_data)
        
        # 버퍼 유지 시간 체크 - 너무 오래된 버퍼는 리셋하되 발화 중이면 대기
        current_time = time.time()
        if current_time - session['buffer_reset_time'] > MAX_BUFFER_AGE:
            # 발화가 진행 중이거나 최근 청크에 내용이 있으면 처리하지 않음
            if not session['speech_in_progress'] and not session['last_chunk_had_content']:
                # 현재 처리 중인 문장이 있으면 강제 처리
                if session['sentence_manager'].current_sentence:
                    logger.info(f"Buffer reset: Processing current sentence before reset: {session['sentence_manager'].current_sentence}")
                    translate_and_send(session_id, session['sentence_manager'].current_sentence)
                    session['sentence_manager'].current_sentence = ""
            
                session['audio_buffer'] = []
                session['buffer_reset_time'] = current_time
                logger.info(f"Buffer age exceeds {MAX_BUFFER_AGE}s, resetting buffer")
        
        # 버퍼가 충분히 차면 처리
        if len(session['audio_buffer']) >= MAX_BUFFER_SIZE:
            process_audio_buffer(session_id)
            
    except Exception as e:
        logger.exception(f"Error processing audio chunk: {e}")
        emit('error', f'Error processing audio chunk: {str(e)}')

def process_audio_buffer(session_id):
    """오디오 버퍼 처리"""
    session = session_manager.get_session(session_id)
    
    # 너무 빈번한 처리 방지 (스로틀링)
    current_time = time.time()
    with audio_processing_lock:
        # 마지막 처리 후 최소 2초 경과 체크
        if current_time - session['last_processing_time'] < min_processing_interval:
            logger.debug(f"Throttling audio processing: {current_time - session['last_processing_time']:.2f}s elapsed")
            return
        session['last_processing_time'] = current_time
    
    buffer_length = len(session['audio_buffer'])
    chunk_num = session['current_chunk']

    # 버퍼가 너무 작으면 처리하지 않음 (최소 2초 분량)
    if buffer_length < 16000 * 2:
        logger.info(f"Buffer too small: {buffer_length} samples, waiting for more data")
        return
        
    logger.info(f"Processing audio buffer: {buffer_length} samples (chunk: {chunk_num})")
    emit("logger", f"server: Processing audio buffer: {buffer_length} samples", room=session_id)
    
    # 처리할 오디오 데이터 준비
    process_buffer = np.array(session['audio_buffer'][:MAX_BUFFER_SIZE])
    
    # 버퍼 소비 비율 변경: 2/3만 소비 (더 많은 오버랩)
    consume_size = int(MAX_BUFFER_SIZE * 2 / 3)
    session['audio_buffer'] = session['audio_buffer'][consume_size:]
    
    # 오디오 에너지 확인
    energy_level = np.sqrt(np.mean(np.square(process_buffer)))
    session['recent_audio_energy'].append(energy_level)
    
    # 평균 에너지 계산 (최근 10개 샘플)
    avg_energy = np.mean(list(session['recent_audio_energy'])) if session['recent_audio_energy'] else 0.008
    
    # 동적 에너지 임계값 (평균의 80%)
    energy_threshold = max(0.005, avg_energy * 0.8)
    
    has_energy = energy_level > energy_threshold
    current_time = time.time()

    # 음성 활동 상태 업데이트
    if has_energy:
        # 음성 감지됨
        session['last_voice_activity_time'] = current_time
        session['silence_duration'] = 0.0
        session['speech_in_progress'] = True
        session['continuous_chunks_count'] += 1
    else:
        # 무음 지속 시간 업데이트
        silence_duration = current_time - session['last_voice_activity_time']
        session['silence_duration'] = silence_duration
        
        # 일정 시간 이상 무음이면 발화 종료로 간주
        if silence_duration > session['min_silence_for_processing'] and session['speech_in_progress']:
            session['speech_in_progress'] = False
            # 발화 종료 처리 - 현재 문장이 있으면 처리
            if session['sentence_manager'].current_sentence:
                logger.info(f"Speech ended, processing current sentence: {session['sentence_manager'].current_sentence}")
                translate_and_send(session_id, session['sentence_manager'].current_sentence)
                session['sentence_manager'].current_sentence = ""
            
            # 연속 청크 카운터 리셋
            session['continuous_chunks_count'] = 0
        
        # 에너지가 너무 낮으면 처리 중단
        if not has_energy and energy_level < energy_threshold * 0.5:
            logger.info(f"Insufficient audio energy: {energy_level:.5f} < {energy_threshold:.5f}")
            return
    
    try:
        # 언어 설정 처리
        use_auto_detect = session['auto_detect']
        task_type = "transcribe"  # 기본값은 transcribe (원본 언어 그대로 인식)
        
        # Whisper 모델 언어 설정
        if use_auto_detect:
            # 감지된 언어가 있으면 해당 언어 사용
            if session['detected_language'] is not None:
                whisper_language = session['whisper_language']
            else:
                # 초기에는 언어가 불확실하므로 언어 지정하지 않음 (자동 감지)
                whisper_language = None
        else:
            # 수동 언어 선택 - 명시적으로 언어 지정
            lang_code = next((k for k, v in LANGUAGE_MAPPING.items() if v == session['source_language']), 'en')
            whisper_language = WHISPER_LANGUAGE_MAPPING.get(lang_code, 'en')
        
        logger.info(f"Using Whisper language: {whisper_language}, auto_detect: {use_auto_detect}")
        
        # Whisper로 텍스트 변환 - 중요 수정 부분
        segments, info = model.transcribe(
            process_buffer,
            beam_size=5,  # 수정: 빔 사이즈 축소하여 처리 속도 개선
            no_speech_threshold=0.6,  # 수정: 임계값 낮춤
            compression_ratio_threshold=2.4,
            # 수정: 이전 텍스트 의존성 제거
            condition_on_previous_text=False,  # 이전 텍스트 참조하지 않음
            initial_prompt=None,  # 초기 프롬프트 없음
            language=whisper_language,
            task="transcribe",
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 300,
                "threshold": 0.5
            }
        )
        
        # 세그먼트에서 텍스트 추출
        new_text = segments_to_text(segments, source_lang=session['source_language'], min_confidence=0.6)
        
        if not new_text:
            logger.info("No text detected in audio")
            return
        
        # 첫 텍스트 감지 후 언어 감지 수행 (아직 감지된 언어가 없을 때)
        if use_auto_detect and session['detected_language'] is None and len(new_text.split()) >= 3:
            # 감지 수행
            detected_nllb_lang, confidence = detect_language(new_text)
            
            if detected_nllb_lang and confidence > 0.3:  # 낮은 임계값 적용
                session['detected_language'] = detected_nllb_lang
                session['language_confidence'] = confidence
                
                # Whisper 언어 코드 업데이트
                lang_code = next((k for k, v in LANGUAGE_MAPPING.items() if v == detected_nllb_lang), 'en')
                session['whisper_language'] = WHISPER_LANGUAGE_MAPPING.get(lang_code, 'en')
                
                # 클라이언트에 감지된 언어 정보 전송
                emit('detected_language', {
                    'language_code': detected_nllb_lang,
                    'confidence': confidence
                }, room=session_id)
                
                logger.info(f"Initially detected language: {detected_nllb_lang} (confidence: {confidence:.4f})")
                emit("logger", f"server: 감지된 언어: {detected_nllb_lang} (신뢰도: {confidence:.2f})", room=session_id)
                
                # 음성 텍스트 변환 다시 수행 (이번에는 감지된 언어 사용)
                logger.info(f"Re-transcribing with detected language: {session['whisper_language']}")
                segments, info = model.transcribe(
                    process_buffer,
                    beam_size=5,
                    condition_on_previous_text=False,  # 수정: 이전 텍스트 참조하지 않음
                    initial_prompt=None,  # 초기 프롬프트 없음
                    language=session['whisper_language'],
                    task="transcribe"  # 항상 transcribe 사용
                )
                
                # 텍스트 다시 추출
                new_text = segments_to_text(segments)
                
                if not new_text:
                    logger.info("No text detected after re-transcription")
                    return
        
        # 텍스트 분리 처리
        handle_text_segmentation(session_id, new_text)
        
        # 문장 관리자 시간 업데이트
        session['sentence_manager'].last_update_time = current_time
        
    except Exception as e:
        logger.exception(f"Error during audio processing: {e}")
        emit('error', f'Error during audio processing: {str(e)}', room=session_id)

def handle_text_segmentation(session_id, new_text):
    """텍스트 세그먼트 처리 및 문장 경계 감지"""
    session = session_manager.get_session(session_id)
    current_time = time.time()
    
    # 텍스트 정리
    new_text = clean_text(new_text)
    
    # 중복 텍스트 확인 강화
    if 'last_processed_text' in session:
        # 이전에 처리한 텍스트와의 유사도 확인
        similarity = difflib.SequenceMatcher(None, session['last_processed_text'], new_text).ratio()
        
        # 유사도가 매우 높은 경우 (중복 텍스트)
        if similarity > 0.95:
            logger.info(f"Duplicate text detected (similarity: {similarity:.2f}), ignoring: {new_text}")
            return
    
    # 최근 처리 텍스트 기록
    session['last_processed_text'] = new_text
    
    # 너무 짧은 텍스트는 무시
    if len(new_text.split()) < 3:
        logger.info(f"Text too short, ignoring: {new_text}")
        session['last_chunk_had_content'] = False
        return
    
    # 문장 관리자
    sentence_mgr = session['sentence_manager']
    prev_sentence = sentence_mgr.current_sentence
    
    # 이전 텍스트 유지를 위한 핵심 로직 개선
    if not prev_sentence:
        # 첫 번째 청크면 그대로 설정
        sentence_mgr.current_sentence = new_text
        logger.info(f"First chunk set: {new_text}")
        session['last_chunk_had_content'] = True
    else:
        # 유사도 확인
        similarity = difflib.SequenceMatcher(None, prev_sentence, new_text).ratio()
        longer_text = prev_sentence if len(prev_sentence) > len(new_text) else new_text
        
        # 1. 확장 케이스: 이전 문장이 새 문장에 포함된 경우 (자연스러운 확장)
        if new_text.startswith(prev_sentence):
            # 자연스러운 문장 확장 - 항상 업데이트
            sentence_mgr.current_sentence = new_text
            logger.info(f"Natural extension: '{prev_sentence}' -> '{new_text}'")
            
        # 2. 역확장 케이스: 새 문장이 이전 문장에 포함된 경우
        elif prev_sentence.startswith(new_text):
            # 이전 문장이 더 길고 완전하다면 그대로 유지
            logger.info(f"Keeping longer previous text: '{prev_sentence}'")
            # 그대로 유지 (아무 작업 없음)
            
        # 3. 유사도 높은 경우: 문맥이 유지되는 경우 
        elif similarity > 0.5:  # 유사도 임계값 상향 조정 (0.4 → 0.5)
            # 공통 부분 찾아 병합 시도
            matcher = difflib.SequenceMatcher(None, prev_sentence, new_text)
            matching_blocks = matcher.get_matching_blocks()
            
            if matching_blocks:
                largest_match = max(matching_blocks, key=lambda x: x.size)
                if largest_match.size > 8:  # 의미 있는 공통 부분 길이 임계값 증가 (6 → 8)
                    # 공통 부분을 기준으로 병합
                    common_text = prev_sentence[largest_match.a:largest_match.a+largest_match.size]
                    a_idx = prev_sentence.find(common_text)
                    b_idx = new_text.find(common_text)
                    
                    if a_idx >= 0 and b_idx >= 0:
                        # 문장 병합 방식 개선: 앞부분은 길이가 긴 쪽 선택, 뒷부분은 새 텍스트에서
                        prefix = prev_sentence[:a_idx] if len(prev_sentence[:a_idx]) > len(new_text[:b_idx]) else new_text[:b_idx]
                        suffix = new_text[b_idx+largest_match.size:]
                        merged_text = prefix + common_text + suffix
                        
                        logger.info(f"Text merged: '{prev_sentence}' + '{new_text}' -> '{merged_text}'")
                        sentence_mgr.current_sentence = merged_text
                    else:
                        # 병합 실패시 더 긴 텍스트 선택
                        sentence_mgr.current_sentence = longer_text
                        logger.info(f"Using longer text after failed merge: '{longer_text}'")
                else:
                    # 공통 부분이 작을 경우 더 긴 텍스트 유지
                    sentence_mgr.current_sentence = longer_text
                    logger.info(f"Using longer text (small common part): '{longer_text}'")
        
        # 4. 완전히 다른 문장 - 문장 경계로 간주하고 새 문장 시작
        else:
            # 이전 문장이 충분히 의미 있으면 번역 처리 후 새 문장 시작
            if len(prev_sentence.split()) >= 5:  # 최소 단어 수 요구 (3 → 5)
                logger.info(f"New sentence detected. Processing previous: '{prev_sentence}'")
                # 이전 문장 처리
                if is_sentence_end(prev_sentence):  # 명확한 문장일 때만 번역
                    translate_and_send(session_id, prev_sentence)
                    # 새 문장 시작
                    sentence_mgr.current_sentence = new_text
                else:
                    # 완전한 문장이 아니라면 병합 시도
                    sentence_mgr.current_sentence = f"{prev_sentence} {new_text}"
                    logger.info(f"Joining incomplete sentences: '{prev_sentence} {new_text}'")
            else:
                # 이전 문장이 너무 짧으면 그냥 새 문장으로 대체
                sentence_mgr.current_sentence = new_text
                logger.info(f"Replacing short previous text: '{prev_sentence}' -> '{new_text}'")

        # 내용이 변경됐는지 여부 확인
        if prev_sentence == sentence_mgr.current_sentence:
            has_new_content = False
        else:
            has_new_content = True
            # 내용이 변경되었음을 기록
            session['last_chunk_had_content'] = True
            # 음성 활동 시간 업데이트 (내용이 바뀌었으므로 활동 중)
            session['last_voice_activity_time'] = current_time
    
    # 실시간 부분 업데이트 전송 (스로틀링 적용)
    if current_time - session.get('last_partial_update', 0) >= session['partial_update_throttle']:
        logger.info(f"Current sentence: {sentence_mgr.current_sentence}")
        emit("logger", f"server: 인식 중: {sentence_mgr.current_sentence}", room=session_id)
        
        # 클라이언트에 현재 문장 전송
        emit('partial_transcription', {
            'text': sentence_mgr.current_sentence,
            'continuous': True
        }, room=session_id)
        
        session['last_partial_update'] = current_time
    
    # 문장 완성 체크 - 중요: 발화가 진행 중이거나 최근 청크에 내용이 있었다면 처리하지 않음!
    if is_sentence_end(sentence_mgr.current_sentence) and not session['speech_in_progress'] and not session['last_chunk_had_content']:
        translate_and_send(session_id, sentence_mgr.current_sentence)
        sentence_mgr.current_sentence = ""

def translate_and_send(session_id, text):
    """텍스트 번역 및 결과 전송"""
    session = session_manager.get_session(session_id)
    
    # 텍스트 정리
    text = clean_text(text)
    
    # 너무 짧은 텍스트는 무시
    if len(text.split()) < 3:
        return
    
    # 중복 확인 강화 - 더 엄격한 중복 체크
    if text in session['transcript_history']:
        logger.info(f"Exact duplicate text, skipping translation: {text}")
        return
    
    # 유사 텍스트 중복 확인 (95% 이상 유사하면 중복으로 간주)
    for prev_text in session['transcript_history'][-5:]:  # 최근 5개 항목만 확인
        similarity = difflib.SequenceMatcher(None, text, prev_text).ratio()
        if similarity > 0.95:
            logger.info(f"Similar text detected (similarity: {similarity:.2f}), skipping: {text}")
            return
    
    # 히스토리에 추가
    session['transcript_history'].append(text)
    
    try:
        # 타겟 언어 가져오기
        target_language = session['target_language']
        
        # 소스 언어 결정
        if session['auto_detect'] and session['detected_language'] is not None:
            source_language = session['detected_language']
        else:
            source_language = session['source_language']
        
        # 같은 언어면 번역하지 않고 그대로 반환
        if source_language == target_language:
            translation_result = text
            logger.info(f"Same language (source and target): {source_language}, skipping translation")
        else:
            # 번역 수행
            translation_result = translator(
                text, 
                src_lang=source_language, 
                tgt_lang=target_language
            )[0]['translation_text']
        
        # 번역 결과 중복 확인
        if translation_result in session['translation_history']:
            logger.info(f"Duplicate translation, skipping: {translation_result}")
            return
        
        # 유사 번역 결과 중복 확인
        for prev_translation in session['translation_history'][-5:]:
            similarity = difflib.SequenceMatcher(None, translation_result, prev_translation).ratio()
            if similarity > 0.95:
                logger.info(f"Similar translation detected (similarity: {similarity:.2f}), skipping: {translation_result}")
                return
        
        # 히스토리에 추가
        session['translation_history'].append(translation_result)
        
        # 결과 전송
        emit('translation', {
            'text': text,
            'translation': translation_result
        }, room=session_id)
        
        emit("logger", f"server: 번역: {translation_result}", room=session_id)
        
    except Exception as e:
        logger.exception(f"Translation error: {e}")

@socketio.on('stop_recording')
def handle_stop():
    session_id = request.sid
    session = session_manager.get_session(session_id)
    session['is_recording'] = False
    
    logger.info("Stop recording")
    emit("logger", "server: Stop recording")
    
    # 남은 버퍼 처리
    if session['audio_buffer'] and len(session['audio_buffer']) > 4000:
        process_audio_buffer(session_id)
    
    # 마지막 문장 처리
    sentence_mgr = session['sentence_manager']
    if sentence_mgr.current_sentence:
        translate_and_send(session_id, sentence_mgr.current_sentence)
        sentence_mgr.current_sentence = ""

@app.route('/')
def index():
    return send_from_directory('../client/public', 'index.html')

if __name__ == '__main__':
    socketio.run(app, debug=False, port=7880)