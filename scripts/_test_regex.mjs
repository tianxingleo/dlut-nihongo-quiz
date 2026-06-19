const t = 'A. 《南京条约》  B. 《虎门条约》  C. 《望厦条约》  D. 《黄埔条约》'
const parts = t
  .split(/(?=[A-E][\.、）)])/)
  .map((s) => s.trim())
  .filter((p) => /^[A-E][\.、）)?]/.test(p))
console.log('parts:', parts)
