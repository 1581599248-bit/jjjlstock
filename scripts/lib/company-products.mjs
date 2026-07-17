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

export function managerProductsForPeriod(manager, scaleRows) {
  const availableCodes = new Set(scaleRows.map((row) => row.code));
  return managerProducts(manager).flatMap((product) => {
    const shareCodes = product.shareCodes.filter((code) => availableCodes.has(code));
    if (!shareCodes.length) return [];
    return [{ ...product, code: shareCodes[0], shareCodes }];
  });
}

export function companyProductsForPeriod(company, scaleRows) {
  const availableCodes = new Set(scaleRows.map((row) => row.code));
  const currentProducts = new Map(companyProducts(company).map((product) => [productKey(product.name), product]));
  const currentOrder = new Map([...currentProducts.keys()].map((key, index) => [key, index]));
  const managersByCode = new Map();
  for (const manager of company.managers) for (const code of manager.fundCodes) {
    const names = managersByCode.get(code) ?? [];
    if (!names.includes(manager.name)) names.push(manager.name);
    managersByCode.set(code, names);
  }

  const grouped = new Map();
  for (const row of scaleRows) {
    const key = productKey(row.name || row.code) || row.code;
    const current = currentProducts.get(key);
    const group = grouped.get(key) ?? {
      code: current?.shareCodes.find((code) => availableCodes.has(code)) ?? row.code,
      name: key,
      shareCodes: [],
      managers: [...(current?.managers ?? [])],
    };
    if (!group.shareCodes.includes(row.code)) group.shareCodes.push(row.code);
    for (const name of managersByCode.get(row.code) ?? []) if (!group.managers.includes(name)) group.managers.push(name);
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .sort(([keyA, productA], [keyB, productB]) => (currentOrder.get(keyA) ?? Number.MAX_SAFE_INTEGER) - (currentOrder.get(keyB) ?? Number.MAX_SAFE_INTEGER) || productA.code.localeCompare(productB.code))
    .map(([, product]) => product);
}
