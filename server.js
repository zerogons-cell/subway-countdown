import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SEOUL_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));

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
      statnNm: item.statnNm,
      updnLine: item.updnLine,
      trainLineNm: item.trainLineNm,
      arvlMsg2: item.arvlMsg2,
      arvlMsg3: item.arvlMsg3,
      arvlCd: item.arvlCd,
      barvlDt: Number(item.barvlDt), // 도착까지 남은 초
      recptnDt: item.recptnDt // 서버가 이 데이터를 수신한 시각
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
