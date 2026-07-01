/**
 * ⚠️ 只读脚本 —— 严禁对文档做任何修改 ⚠️
 * 本脚本仅读取数据并 return，不允许出现任何写入操作：
 *   禁止：.Value=  .Value2=  .Text=  .Insert  .Delete  .Clear  .Save  .Add  等
 *   允许：.Value2(读)  .Text(读)  .Cells/.Range/.UsedRange(读)
 *
 * 正式读取脚本 v2：逐格读取 Sheet1，清洗后返回 JSON。
 * - 表头去除换行/空格
 * - 日期列用 .Text 取显示值（如「5月17日」）
 * - 合同列 ✅ 转 true，空转 false
 * - 跳过整行为空的行
 */
const sheet = Application.Sheets.Item('Sheet1')
const usedRange = sheet.UsedRange
const rowCount = usedRange.Rows.Count
// UsedRange 有时算不到“收货地址”列，强制至少读到第 19 列
const colCount = Math.max(usedRange.Columns.Count, 19)

// 需要按“显示文本”读取的列名（日期等），用 .Text 而不是 .Value2
const TEXT_COLS = ['建群时间', '合作时间']

// 读表头并清洗（去掉换行、首尾空格、内部多余空白）
const headers = []
for (let c = 1; c <= colCount; c++) {
  let h = sheet.Cells.Item(1, c).Value2
  h = (h === null || h === undefined) ? '' : String(h)
  h = h.replace(/\s+/g, '').trim() // 去掉所有空白和换行
  headers.push(h || ('col' + c))
}

// 逐行读取
const rows = []
for (let r = 2; r <= rowCount; r++) {
  const obj = {}
  let isEmpty = true
  for (let c = 1; c <= colCount; c++) {
    const cell = sheet.Cells.Item(r, c)
    const name = headers[c - 1]
    let v

    if (TEXT_COLS.indexOf(name) >= 0) {
      // 日期等：取显示文本
      v = cell.Text
    } else {
      v = cell.Value2
    }

    if (v === null || v === undefined) v = ''

    // 合同列：对勾转布尔
    if (name === '合同') {
      const s = String(v).trim()
      v = (s === '✅' || s === '√' || s === 'TRUE' || s === 'true' || s === '是')
    }

    if (v !== '' && v !== false) isEmpty = false
    obj[name] = v
  }
  // 用“姓名”或“电话”判断是否有效行，比整行空更准
  if (!isEmpty && (String(obj['姓名'] || '').trim() !== '')) {
    rows.push(obj)
  }
}

return JSON.stringify({ headers: headers, rows: rows, total: rows.length })
