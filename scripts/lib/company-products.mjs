export const productKey = (name) => name
  .replace(/\s+/g, "")
  .replace(/(?:人民币|美元现汇|美元现钞|美汇|美钞|美元)(?=[（(]|$)/i, "")
  .replace(/[A-EHIOY](?:\d+)?(?=[（(]|$)/i, "")
  .replace(/(?:人民币|美元现汇|美元现钞|美汇|美钞|美元)$/i, "")
  .replace(/[A-EHIOY](?:\d+)?$/i, "")
  .trim();

export function managerProducts(manager) {
  const grouped = new Map();
  manager.fundCodes.forEach((code, index) => {
    const name = manager.fundNames[index] ?? code;
    const key = productKey(name);
    const group = grouped.get(key) ?? { code, name, shareCodes: [] };
    if (!group.shareCodes.includes(code)) group.shareCodes.push(code);
    grouped.set(key, group);
  });
  return [...grouped.values()];
}

export function companyProducts(company) {
  const grouped = new Map();
  for (const manager of company.managers) {
    for (const product of managerProducts(manager)) {
      const key = productKey(product.name);
      const group = grouped.get(key) ?? { code: product.code, name: key, shareCodes: [], managers: [] };
      for (const code of product.shareCodes) if (!group.shareCodes.includes(code)) group.shareCodes.push(code);
      if (!group.managers.includes(manager.name)) group.managers.push(manager.name);
      grouped.set(key, group);
    }
  }
  return [...grouped.values()];
}
