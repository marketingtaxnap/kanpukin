/* =====================================================================
 * calc.js ― 還付金診断 計算エンジン（税理士レビュー反映版）
 * ---------------------------------------------------------------------
 * answers（回答）を受け取り、①②③④の判定と金額を返す。
 * 税の数字はすべて config.js から参照（このファイルに数字は埋め込まない）。
 *
 *  STEP1 源泉徴収額   STEP2 本当の所得税   STEP3 還付/納付の判定
 *  ・基礎控除は合計所得別テーブル（最大95万）。副業は合算して1回だけ。
 *  ・社会保険料控除は本業（個人事業主）のみ。
 *  ・課税所得は1,000円未満切り捨て。所得税額に復興特別所得税2.1%。
 * ===================================================================== */

(function (global) {
  const C = (typeof CONFIG !== 'undefined') ? CONFIG : require('./config.js');
  const MAN = 10000; // 万円→円

  /* 所得税（速算表・課税所得は1,000円未満切り捨て） */
  function incomeTax(taxable) {
    if (taxable <= 0) return 0;
    taxable = Math.floor(taxable / 1000) * 1000;
    for (const b of C.taxBrackets) {
      if (taxable <= b.limit) return taxable * b.rate - b.deduction;
    }
    return 0;
  }

  /* 給与所得控除（令和2年分以降） */
  function salaryDeduction(income) {
    if (income <= 0) return 0;
    if (income <= 1625000) return 550000;
    if (income <= 1800000) return income * 0.40 - 100000;
    if (income <= 3600000) return income * 0.30 + 80000;
    if (income <= 6600000) return income * 0.20 + 440000;
    if (income <= 8500000) return income * 0.10 + 1100000;
    return 1950000;
  }

  /* 復興特別所得税2.1%を上乗せ */
  function withReconstruction(tax) { return tax * (1 + C.reconstructionRate); }

  /* 基礎控除（合計所得金額に応じた額・令和8年） */
  function basicDeduction(goukei) {
    for (const b of C.basicDeductionTable) {
      if (goukei <= b.limit) return b.deduction;
    }
    return 0;
  }

  /* 社会保険料 概算（本業＝個人事業主のみ。国民年金＋国保） */
  function shakaiHoken(jigyo) {
    const kokuho = Math.min(
      C.kokuhoCap,
      Math.max(0, jigyo - C.kokuhoDeduction) * C.kokuhoIncomeRate + C.kokuhoFlat
    );
    return C.kokuminNenkin + kokuho;
  }

  /* -------------------------------------------------------------------
   * 夜職の事業所得 biz（青色控除前）→ 夜職分の所得税（復興税込み）
   *  本業：合計所得＝事業所得。基礎控除＋社会保険料を引く
   *  副業：合計所得＝給与所得＋事業所得。基礎控除は合算に1回だけ。
   *        「総所得税 − 給与分（昼で年末調整済み）」で夜職分を取り出す
   * ----------------------------------------------------------------- */
  function yakoIncomeTax(biz, opts) {
    const bizN = Math.max(0, biz - (opts.blue ? Math.min(C.aoiroDeduction, Math.max(0, biz)) : 0));

    if (opts.hasDayJob) {
      const dayYen = (opts.dayIncome || 0) * MAN;
      const kyuyo  = Math.max(0, dayYen - salaryDeduction(dayYen));            // 給与所得
      const taxAll = incomeTax(Math.max(0, (kyuyo + bizN) - basicDeduction(kyuyo + bizN))); // 総所得税
      const taxDay = incomeTax(Math.max(0, kyuyo - basicDeduction(kyuyo)));    // 昼で既に納めた分
      return withReconstruction(taxAll - taxDay);
    }

    const shaho = shakaiHoken(bizN);
    return withReconstruction(incomeTax(Math.max(0, bizN - basicDeduction(bizN) - shaho)));
  }

  /* -------------------------------------------------------------------
   * メイン：診断
   * answers = {
   *   job, filed(bool), blueFiling('blue'|'white'|'unknown'),
   *   hasDayJob(bool), dayIncome(万円),
   *   yearReward(万円), yearExpense(万円), weekDays('1-2'|'3-4'|'5+')
   * }
   * 返り値 = { type, label, amount(今年分), expenseRatio, avgRatio, note }
   * ----------------------------------------------------------------- */
  function diagnose(a) {
    const yenReward  = (a.yearReward  || 0) * MAN;
    const yenExpense = (a.yearExpense || 0) * MAN;
    const bizIncome  = Math.max(0, yenReward - yenExpense);
    const expenseRatio = yenReward > 0 ? yenExpense / yenReward : 0;

    /* STEP1：源泉徴収額（接待系のみ） */
    let genzei = 0;
    if (C.genzeiByJob[a.job]) {
      // 源泉の5,000円控除に使う「日数」。国税庁の定義は計算期間の暦日数。
      //   日払い   → 1回＝1日なので 出勤日数(年) を使う
      //   まとめ払い → 週・月単位なので 暦日数(年≒365) を使う
      const days = (a.payType === 'lump')
        ? C.yearCalendarDays
        : (C.monthlyWorkDays[a.weekDays] || 0) * 12;
      genzei = Math.max(0, yenReward - C.dailyDeduction * days) * C.genzeiRate;
    }

    /* 申告済み → ③ / ④（経費割合で判定） */
    if (a.filed) {
      const opts = { blue: a.blueFiling === 'blue', hasDayJob: a.hasDayJob, dayIncome: a.dayIncome };
      if (expenseRatio < C.avgExpenseRatio) {
        const addExpense  = (C.avgExpenseRatio - expenseRatio) * yenReward;
        const recoverable = yakoIncomeTax(bizIncome, opts) - yakoIncomeTax(Math.max(0, bizIncome - addExpense), opts);
        return {
          type: '③', label: '経費の取りこぼし（取り戻せる）',
          amount: Math.round(Math.max(0, recoverable)),
          expenseRatio, avgRatio: C.avgExpenseRatio,
          note: '更正の請求（過去最大3年・領収書が必要）',
        };
      }
      return {
        type: '④', label: '経費の取りこぼしなし',
        amount: 0, expenseRatio, avgRatio: C.avgExpenseRatio,
        note: '税務調査リスクチェックへ',
      };
    }

    /* 無申告 → ① / ②（／申告不要） */
    const yakoTax = yakoIncomeTax(bizIncome, { blue: false, hasDayJob: a.hasDayJob, dayIncome: a.dayIncome });
    const refund  = genzei - yakoTax;

    if (refund > 0) {
      return { type: '①', label: '払いすぎた税金が戻る', amount: Math.round(refund),
               expenseRatio, avgRatio: C.avgExpenseRatio, note: '還付申告（任意・最大3年・罰金なし）' };
    }
    if (yakoTax <= 0) {
      return { type: 'exempt', label: '申告不要', amount: 0,
               expenseRatio, avgRatio: C.avgExpenseRatio, note: '所得が少なく確定申告は不要' };
    }
    return { type: '②', label: '追加で税金を払う', amount: Math.round(-refund),
             expenseRatio, avgRatio: C.avgExpenseRatio, note: '確定申告（義務）。今やればダメージ最小' };
  }

  const API = { diagnose, incomeTax, salaryDeduction, basicDeduction, shakaiHoken };
  if (typeof module !== 'undefined') module.exports = API;
  global.Kanpukin = API;
})(typeof window !== 'undefined' ? window : globalThis);
