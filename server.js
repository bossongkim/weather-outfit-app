require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5500;
const AIRKOREA_SERVICE_KEY = process.env.AIRKOREA_SERVICE_KEY || "";

app.use(express.static(path.join(__dirname)));

// 프론트엔드는 이 엔드포인트만 호출한다. 실제 공공데이터포털 인증키는
// 서버(.env)에만 보관되어 브라우저로 노출되지 않는다.
app.get("/api/air-quality", async (req, res) => {
  const sido = req.query.sido;
  if (!sido) {
    return res.status(400).json({ error: "sido 쿼리 파라미터가 필요합니다." });
  }
  if (!AIRKOREA_SERVICE_KEY) {
    return res.status(503).json({ error: "서버에 AIRKOREA_SERVICE_KEY가 설정되어 있지 않습니다." });
  }

  const params = new URLSearchParams({
    serviceKey: AIRKOREA_SERVICE_KEY,
    returnType: "json",
    numOfRows: "100",
    pageNo: "1",
    sidoName: sido,
    ver: "1.3",
  });
  const url = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?${params.toString()}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    console.error("에어코리아 API 호출 실패:", err);
    res.status(502).json({ error: "에어코리아 API 호출에 실패했습니다." });
  }
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
