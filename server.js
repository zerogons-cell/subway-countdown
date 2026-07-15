import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SEOUL_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));

// subwayNm이 API에서 null로 오는 경우가 많아 subwayId로 직접 매핑한다.
const LINE_NAMES = {
  1001: '1호선',
  1002: '2호선',
  1003: '3호선',
  1004: '4호선',
  1005: '5호선',
  1006: '6호선',
  1007: '7호선',
  1008: '8호선',
  1009: '9호선',
  1063: '경의중앙선',
  1065: '공항철도',
  1067: '경춘선',
  1075: '수인분당선',
  1077: '신분당선',
  1081: '경강선',
  1092: '우이신설선',
  1093: '서해선',
  1094: '김포골드라인',
  1095: '동해선',
  1096: '신림선'
};

function getLineName(subwayId, subwayNm) {
  if (subwayNm) return subwayNm;
  if (LINE_NAMES[subwayId]) return LINE_NAMES[subwayId];
  return subwayId ? `노선(${subwayId})` : '노선 미상';
}

// barvlDt(남은 초)는 "지금부터"가 아니라 recptnDt(서울시 시스템이 열차 위치를
// 계산한 시각) 기준이다. recptnDt는 타임존 표기가 없는 한국 표준시(KST, UTC+9)
// 문자열이라 항상 KST로 고정 해석해야 배포 서버의 타임존(대부분 UTC)과 무관하게
// 정확한 값이 나온다. 이 값을 빼주지 않으면 데이터가 실제로 몇 초~몇십 초(때로는
// 그 이상) 지난 뒤에 표시되는 만큼 카운트다운이 항상 실제보다 느리게(더 많이
// 남은 것처럼) 표시된다.
function parseKstEpoch(recptnDt) {
  if (!recptnDt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(recptnDt);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h - 9, mi, s);
}

// 서울 열린데이터광장 실시간 지하철 도착정보 프록시
// 브라우저에서 직접 호출 시 CORS가 막혀 있어 서버를 거쳐 전달한다.
app.get('/api/arrivals', async (req, res) => {
  const station = (req.query.station || '').trim();
  if (!station) {
    return res.status(400).json({ error: '역 이름을 입력해주세요.' });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: 'SEOUL_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.' });
  }

  const url = `http://swopenapi.seoul.go.kr/api/subway/${API_KEY}/json/realtimeStationArrival/0/20/${encodeURIComponent(station)}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();

    // 인증키 오류 등은 최상위 {code, message}로 오고,
    // 정상 인증 후 서비스 레벨 안내(데이터 없음 등)는 errorMessage.code로 온다.
    if (data.code && data.code !== 'INFO-000') {
      return res.status(200).json({
        error: data.message || '요청을 처리할 수 없습니다.',
        code: data.code
      });
    }
    if (data.errorMessage && data.errorMessage.code !== 'INFO-000') {
      return res.status(200).json({
        error: data.errorMessage.message || '해당 역 정보를 찾을 수 없습니다.',
        code: data.errorMessage.code
      });
    }

    const list = (data.realtimeArrivalList || []).map((item) => ({
      subwayId: item.subwayId,
      subwayNm: item.subwayNm,
      lineName: getLineName(item.subwayId, item.subwayNm),
      statnNm: item.statnNm,
      updnLine: item.updnLine,
      trainLineNm: item.trainLineNm,
      arvlMsg2: item.arvlMsg2,
      arvlMsg3: item.arvlMsg3,
      arvlCd: item.arvlCd,
      btrainNo: item.btrainNo, // 실제 열차를 구분하는 고유 열차번호 (도착 기록 중복 방지용)
      barvlDt: Number(item.barvlDt), // recptnDt 시점 기준 도착까지 남은 초
      recptnDt: item.recptnDt, // 서울시 시스템이 열차 위치를 계산한 시각(KST)
      recptnEpoch: parseKstEpoch(item.recptnDt) // 위 시각의 ms epoch (클라이언트 보정용)
    }));

    res.json({ list, serverTime: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: '지하철 API 호출에 실패했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

app.listen(PORT, () => {
  console.log(`지하철 카운트다운 서버 실행 중: http://localhost:${PORT}`);
});
