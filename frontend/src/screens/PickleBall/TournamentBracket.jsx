// src/DemoTournamentStages.jsx
import { useMemo, useState } from 'react';
import _ from 'lodash';
import { Bracket } from 'react-brackets';
import { Box, Tabs, Tab, Paper, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert } from '@mui/material';
/* ---------- 1. MOCK DATA (15 trận) ---------- */
const sampleMatches = [
  {
    _id: "1",
    stage: "group",
    group: "A",
    round: 1,
    code: "A‑R1‑M1",
    team1: "Đội A1",
    team2: "Đội A2",
    score1: 10,
    score2: 5,
    status: "Hoàn thành"
  },
  {
    _id: "2",
    stage: "group",
    group: "A",
    round: 2,
    code: "A‑R2‑M2",
    team1: "Đội A1",
    team2: "Đội A3",
    score1: 10,
    score2: 11,
    status: "Hoàn thành"
  },
  {
    _id: "3",
    stage: "group",
    group: "A",
    round: 3,
    code: "A‑R3‑M3",
    team1: "Đội A1",
    team2: "Đội A4",
    score1: 8,
    score2: 4,
    status: "Hoàn thành"
  },
  {
    _id: "4",
    stage: "group",
    group: "A",
    round: 4,
    code: "A‑R4‑M4",
    team1: "Đội A2",
    team2: "Đội A3",
    score1: 6,
    score2: 4,
    status: "Hoàn thành"
  },
  {
    _id: "5",
    stage: "group",
    group: "A",
    round: 5,
    code: "A‑R5‑M5",
    team1: "Đội A2",
    team2: "Đội A4",
    score1: 10,
    score2: 7,
    status: "Hoàn thành"
  },
  {
    _id: "6",
    stage: "group",
    group: "A",
    round: 6,
    code: "A‑R6‑M6",
    team1: "Đội A3",
    team2: "Đội A4",
    score1: 8,
    score2: 7,
    status: "Hoàn thành"
  },
  {
    _id: "7",
    stage: "group",
    group: "B",
    round: 1,
    code: "B‑R1‑M7",
    team1: "Đội B1",
    team2: "Đội B2",
    score1: 10,
    score2: 11,
    status: "Hoàn thành"
  },
  {
    _id: "8",
    stage: "group",
    group: "B",
    round: 2,
    code: "B‑R2‑M8",
    team1: "Đội B1",
    team2: "Đội B3",
    score1: 1,
    score2: 5,
    status: "Hoàn thành"
  },
  {
    _id: "9",
    stage: "group",
    group: "B",
    round: 3,
    code: "B‑R3‑M9",
    team1: "Đội B1",
    team2: "Đội B4",
    score1: 0,
    score2: 8,
    status: "Hoàn thành"
  },
  {
    _id: "10",
    stage: "group",
    group: "B",
    round: 4,
    code: "B‑R4‑M10",
    team1: "Đội B2",
    team2: "Đội B3",
    score1: 4,
    score2: 7,
    status: "Hoàn thành"
  },
  {
    _id: "11",
    stage: "group",
    group: "B",
    round: 5,
    code: "B‑R5‑M11",
    team1: "Đội B2",
    team2: "Đội B4",
    score1: 5,
    score2: 5,
    status: "Chưa"
  },
  {
    _id: "12",
    stage: "group",
    group: "B",
    round: 6,
    code: "B‑R6‑M12",
    team1: "Đội B3",
    team2: "Đội B4",
    score1: 7,
    score2: 1,
    status: "Hoàn thành"
  },
  {
    _id: "13",
    stage: "group",
    group: "C",
    round: 1,
    code: "C‑R1‑M13",
    team1: "Đội C1",
    team2: "Đội C2",
    score1: 5,
    score2: 0,
    status: "Hoàn thành"
  },
  {
    _id: "14",
    stage: "group",
    group: "C",
    round: 2,
    code: "C‑R2‑M14",
    team1: "Đội C1",
    team2: "Đội C3",
    score1: 5,
    score2: 5,
    status: "Chưa"
  },
  {
    _id: "15",
    stage: "group",
    group: "C",
    round: 3,
    code: "C‑R3‑M15",
    team1: "Đội C1",
    team2: "Đội C4",
    score1: 9,
    score2: 10,
    status: "Hoàn thành"
  },
  {
    _id: "16",
    stage: "group",
    group: "C",
    round: 4,
    code: "C‑R4‑M16",
    team1: "Đội C2",
    team2: "Đội C3",
    score1: 7,
    score2: 11,
    status: "Hoàn thành"
  },
  {
    _id: "17",
    stage: "group",
    group: "C",
    round: 5,
    code: "C‑R5‑M17",
    team1: "Đội C2",
    team2: "Đội C4",
    score1: 6,
    score2: 11,
    status: "Hoàn thành"
  },
  {
    _id: "18",
    stage: "group",
    group: "C",
    round: 6,
    code: "C‑R6‑M18",
    team1: "Đội C3",
    team2: "Đội C4",
    score1: 10,
    score2: 5,
    status: "Hoàn thành"
  },
  {
    _id: "19",
    stage: "group",
    group: "D",
    round: 1,
    code: "D‑R1‑M19",
    team1: "Đội D1",
    team2: "Đội D2",
    score1: 0,
    score2: 7,
    status: "Hoàn thành"
  },
  {
    _id: "20",
    stage: "group",
    group: "D",
    round: 2,
    code: "D‑R2‑M20",
    team1: "Đội D1",
    team2: "Đội D3",
    score1: 4,
    score2: 7,
    status: "Hoàn thành"
  },
  {
    _id: "21",
    stage: "group",
    group: "D",
    round: 3,
    code: "D‑R3‑M21",
    team1: "Đội D1",
    team2: "Đội D4",
    score1: 3,
    score2: 8,
    status: "Hoàn thành"
  },
  {
    _id: "22",
    stage: "group",
    group: "D",
    round: 4,
    code: "D‑R4‑M22",
    team1: "Đội D2",
    team2: "Đội D3",
    score1: 11,
    score2: 6,
    status: "Hoàn thành"
  },
  {
    _id: "23",
    stage: "group",
    group: "D",
    round: 5,
    code: "D‑R5‑M23",
    team1: "Đội D2",
    team2: "Đội D4",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "24",
    stage: "group",
    group: "D",
    round: 6,
    code: "D‑R6‑M24",
    team1: "Đội D3",
    team2: "Đội D4",
    score1: 2,
    score2: 4,
    status: "Hoàn thành"
  },
  {
    _id: "25",
    stage: "group",
    group: "E",
    round: 1,
    code: "E‑R1‑M25",
    team1: "Đội E1",
    team2: "Đội E2",
    score1: 8,
    score2: 5,
    status: "Hoàn thành"
  },
  {
    _id: "26",
    stage: "group",
    group: "E",
    round: 2,
    code: "E‑R2‑M26",
    team1: "Đội E1",
    team2: "Đội E3",
    score1: 0,
    score2: 8,
    status: "Hoàn thành"
  },
  {
    _id: "27",
    stage: "group",
    group: "E",
    round: 3,
    code: "E‑R3‑M27",
    team1: "Đội E1",
    team2: "Đội E4",
    score1: 3,
    score2: 11,
    status: "Hoàn thành"
  },
  {
    _id: "28",
    stage: "group",
    group: "E",
    round: 4,
    code: "E‑R4‑M28",
    team1: "Đội E2",
    team2: "Đội E3",
    score1: 3,
    score2: 2,
    status: "Hoàn thành"
  },
  {
    _id: "29",
    stage: "group",
    group: "E",
    round: 5,
    code: "E‑R5‑M29",
    team1: "Đội E2",
    team2: "Đội E4",
    score1: 1,
    score2: 4,
    status: "Hoàn thành"
  },
  {
    _id: "30",
    stage: "group",
    group: "E",
    round: 6,
    code: "E‑R6‑M30",
    team1: "Đội E3",
    team2: "Đội E4",
    score1: 2,
    score2: 8,
    status: "Hoàn thành"
  },
  {
    _id: "31",
    stage: "playoff",
    round: 1,
    code: "V1‑B1",
    team1: "W‑G1‑1",
    team2: "L‑G1‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "32",
    stage: "playoff",
    round: 1,
    code: "V1‑B2",
    team1: "W‑G2‑1",
    team2: "L‑G2‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "33",
    stage: "playoff",
    round: 1,
    code: "V1‑B3",
    team1: "W‑G3‑1",
    team2: "L‑G3‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "34",
    stage: "playoff",
    round: 1,
    code: "V1‑B4",
    team1: "W‑G4‑1",
    team2: "L‑G4‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "35",
    stage: "playoff",
    round: 1,
    code: "V1‑B5",
    team1: "W‑G5‑1",
    team2: "L‑G5‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "36",
    stage: "playoff",
    round: 1,
    code: "V1‑B6",
    team1: "W‑G6‑1",
    team2: "L‑G6‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "37",
    stage: "playoff",
    round: 1,
    code: "V1‑B7",
    team1: "W‑G7‑1",
    team2: "L‑G7‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "38",
    stage: "playoff",
    round: 1,
    code: "V1‑B8",
    team1: "W‑G8‑1",
    team2: "L‑G8‑2",
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "39",
    stage: "ko",
    round: 1,
    code: "V2‑QF1",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "40",
    stage: "ko",
    round: 1,
    code: "V2‑QF2",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "41",
    stage: "ko",
    round: 1,
    code: "V2‑QF3",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "42",
    stage: "ko",
    round: 1,
    code: "V2‑QF4",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "43",
    stage: "ko",
    round: 1,
    code: "V2‑QF5",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "44",
    stage: "ko",
    round: 1,
    code: "V2‑QF6",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "45",
    stage: "ko",
    round: 1,
    code: "V2‑QF7",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "46",
    stage: "ko",
    round: 1,
    code: "V2‑QF8",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "47",
    stage: "ko",
    round: 2,
    code: "V3‑SF1",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "48",
    stage: "ko",
    round: 2,
    code: "V3‑SF2",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "49",
    stage: "ko",
    round: 2,
    code: "V3‑SF3",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "50",
    stage: "ko",
    round: 2,
    code: "V3‑SF4",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "51",
    stage: "ko",
    round: 3,
    code: "V4‑FNL1",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "52",
    stage: "ko",
    round: 3,
    code: "V4‑FNL2",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  },
  {
    _id: "53",
    stage: "ko",
    round: 4,
    code: "V5‑FNL1",
    team1: null,
    team2: null,
    score1: 0,
    score2: 0,
    status: "Chưa"
  }
]

const splitByStage = (m) => ({
  group  : m.filter(x=>x.stage==='group'),
  playoff: m.filter(x=>x.stage==='playoff'),
  ko     : m.filter(x=>x.stage==='ko')
});

const calcStandings = (m) => {
  const tbl = {};
  m.forEach(x => {
    const g = x.group;
    if (!tbl[g]) tbl[g] = {};
    const add = (t, pts, gf, ga) => {
      if (!tbl[g][t]) tbl[g][t] = { P:0, W:0, D:0, L:0, GF:0, GA:0 };
      const o = tbl[g][t];
      Object.assign(o, {
        P: o.P + pts, GF: o.GF + gf, GA: o.GA + ga,
        W: o.W + (pts === 3), D: o.D + (pts === 1), L: o.L + (pts === 0)
      });
    };
    const { score1=0, score2=0 } = x;
    let p1=0, p2=0;
    if (score1 > score2) p1=3; else if (score2 > score1) p2=3; else if (score1 === score2) { p1=p2=1; }
    add(x.team1 || 'TBD', p1, score1, score2);
    add(x.team2 || 'TBD', p2, score2, score1);
  });
  return _.mapValues(tbl, teams =>
    Object.entries(teams).sort((a,b)=> b[1].P - a[1].P || (b[1].GF - b[1].GA) - (a[1].GF - a[1].GA))
  );
};

const placeholderTeam = (seedCode, winner=true) => {
  const [prefix, label] = seedCode.split('‑');
  const prevRound = 'V' + (Number(prefix.slice(1)) - 1);
  const ref = label.replace(/^SF/, 'QF').replace(/^FNL/, 'SF1');
  return (winner ? 'W‑' : 'L‑') + prevRound + '‑' + ref;
};

const toRounds = (list) => {
  const by = _.groupBy(list, 'round');
  return Object.entries(by).sort((a,b)=> a[0]-b[0]).map(([no, seeds]) => ({
    title: `Vòng ${no}`,
    seeds: seeds.map(s => {
      const t1 = s.team1 || placeholderTeam(s.code, true);
      const t2 = s.team2 || placeholderTeam(s.code, false);
      return {
        id: s._id,
        date: '',
        teams: [
          { name: t1, score: s.score1 },
          { name: t2, score: s.score2 },
        ]
      };
    })
  }));
};

/* ---------- 3. UI Cells ---------- */
const MatchRow = ({ m }) => (
  <TableRow>
    <TableCell>{m.code}</TableCell>
    <TableCell>{m.team1 || placeholderTeam(m.code, true)}</TableCell>
    <TableCell align="center">{m.score1 ?? '-'}</TableCell>
    <TableCell align="center">–</TableCell>
    <TableCell align="center">{m.score2 ?? '-'}</TableCell>
    <TableCell>{m.team2 || placeholderTeam(m.code, false)}</TableCell>
    <TableCell>{m.status}</TableCell>
  </TableRow>
);

const Standing = ({ rows }) => (
  <Table size="small" sx={{ mt: 2 }} >
    <TableHead>
      <TableRow>
        <TableCell>#</TableCell>
        <TableCell>Đội</TableCell>
        <TableCell>P</TableCell>
        <TableCell>W‑D‑L</TableCell>
        <TableCell>HS</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {rows.map(([t,s],i) => (
        <TableRow key={t}>
          <TableCell>{i+1}</TableCell>
          <TableCell>{t}</TableCell>
          <TableCell>{s.P}</TableCell>
          <TableCell>{`${s.W}-${s.D}-${s.L}`}</TableCell>
          <TableCell>{s.GF - s.GA}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/* ---------- 4. Component ---------- */
export default function DemoTournamentStages() {
  const [tab, setTab] = useState(0);

  const { group, playoff, ko } = useMemo(() => splitByStage(sampleMatches), []);
  const standings = useMemo(() => calcStandings(group), [group]);
  const roundsPlayoff = useMemo(() => toRounds(playoff), [playoff]);
  const roundsKO = useMemo(() => toRounds(ko), [ko]);

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs value={tab} onChange={(e,v)=>setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Vòng bảng" />
        <Tab label="Play‑off (V1)" />
        <Tab label="Knock‑out" />
      </Tabs>

      {tab === 0 && (
        group.length === 0 ? <Alert severity="warning">Chưa có dữ liệu vòng bảng.</Alert> :
        Object.entries(_.groupBy(group, 'group')).map(([g, list]) => (
          <Paper key={g} sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Bảng {g}</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Mã</TableCell>
                  <TableCell colSpan={2} align="center">Đội 1</TableCell>
                  <TableCell />
                  <TableCell colSpan={2} align="center">Đội 2</TableCell>
                  <TableCell>TT</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{list.map((m) => <MatchRow key={m._id} m={m} />)}</TableBody>
            </Table>
            {standings[g] && <Standing rows={standings[g]} />}
          </Paper>
        ))
      )}

      {tab === 1 && (
        roundsPlayoff.length ? <Bracket rounds={roundsPlayoff} /> :
        <Alert severity="warning">Chưa có dữ liệu play‑off.</Alert>
      )}

      {tab === 2 && (
        roundsKO.length ? <Bracket rounds={roundsKO} /> :
        <Alert severity="warning">Chưa có dữ liệu knock‑out.</Alert>
      )}
    </Box>
  );
}