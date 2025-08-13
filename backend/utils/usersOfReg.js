function usersOfReg(reg) {
  if (!reg) return [];
  const u1 = reg?.player1?.user ? String(reg.player1.user) : null;
  const u2 = reg?.player2?.user ? String(reg.player2.user) : null;
  return [u1, u2].filter(Boolean);
}

export default usersOfReg;