/* Monerem paycheck math (shared by app.html and paycheck-calculator.html).
   An ESTIMATE of take-home pay for 2026, using:
   - 2026 federal brackets and standard deduction (IRS inflation adjustments, Oct 2025)
   - Social Security 6.2% up to the 2026 wage base of $184,500; Medicare 1.45%, plus 0.9% above $200,000
   - Pre-tax 401(k) lowers income tax but not Social Security/Medicare
   - Pre-tax health, dental and vision lower all three
   - A flat state rate the member chooses (0 for states with no income tax)
   Update the numbers in TAX each January. */
(function () {
  var TAX = {
    year: 2026,
    std: { single: 16100, married: 32200 },
    brackets: {
      single:  [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
      married: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]]
    },
    ssRate: 0.062, ssBase: 184500,
    medRate: 0.0145, addMedRate: 0.009, addMedOver: 200000
  };
  var PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
  var NO_TAX_STATES = ["Alaska", "Florida", "Nevada", "New Hampshire", "South Dakota", "Tennessee", "Texas", "Washington", "Wyoming"];

  function fedTax(taxable, status) {
    var b = TAX.brackets[status] || TAX.brackets.single, tax = 0, lo = 0;
    for (var i = 0; i < b.length && taxable > lo; i++) { var hi = b[i][0]; tax += (Math.min(taxable, hi) - lo) * b[i][1]; lo = hi; }
    return tax;
  }
  function marginal(taxable, status) {
    var b = TAX.brackets[status] || TAX.brackets.single;
    for (var i = 0; i < b.length; i++) if (taxable <= b[i][0]) return b[i][1];
    return b[b.length - 1][1];
  }
  function r2(x) { return Math.round(x * 100) / 100; }

  /* o: { gross (yearly pay), status ("single"|"married"), freq, k401Pct, insPerCheck, stateRate (percent) } */
  function calc(o) {
    var n = PER_YEAR[o.freq] || 26, status = o.status === "married" ? "married" : "single";
    var gross = Math.max(0, +o.gross || 0);
    var k401 = Math.min(gross, gross * Math.max(0, Math.min(100, +o.k401Pct || 0)) / 100);
    var ins = Math.min(gross - k401, Math.max(0, +o.insPerCheck || 0) * n);
    var fedWages = Math.max(0, gross - k401 - ins), ficaWages = Math.max(0, gross - ins);
    var taxable = Math.max(0, fedWages - TAX.std[status]);
    var fed = fedTax(taxable, status);
    var ss = Math.min(ficaWages, TAX.ssBase) * TAX.ssRate;
    var med = ficaWages * TAX.medRate + Math.max(0, ficaWages - TAX.addMedOver) * TAX.addMedRate;
    var state = fedWages * Math.max(0, +o.stateRate || 0) / 100;
    var take = gross - k401 - ins - fed - ss - med - state;
    var yr = { gross: gross, k401: k401, ins: ins, fed: fed, ss: ss, med: med, state: state, take: take };
    var per = {}, mon = {};
    Object.keys(yr).forEach(function (k) { per[k] = r2(yr[k] / n); mon[k] = r2(yr[k] / 12); yr[k] = r2(yr[k]); });
    return { year: yr, check: per, month: mon, checksPerYear: n, taxable: r2(taxable), bracket: marginal(taxable, status),
      effective: gross ? (fed + ss + med + state) / gross : 0, taxYear: TAX.year };
  }
  window.MoneremPay = { calc: calc, PER_YEAR: PER_YEAR, NO_TAX_STATES: NO_TAX_STATES, TAX: TAX };
})();
