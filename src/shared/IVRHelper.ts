export const opcionConfirmar = 'Si es correcto marque 1 - sino marque 2';
export const montoRound = (monto: number): number => {
  return monto === null ? 0 : Math.round(monto * 100) / 100;
};
export function groupBy<T, K extends keyof any>(
  array: T[],
  key: (item: T) => K,
): Record<K, T[]> {
  return array.reduce(
    (result, item) => {
      const groupKey = key(item);
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    },
    {} as Record<K, T[]>,
  );
}
export const ImpuestoVehicular = '';
export const ImpuestoPredial = 'Imp. Predial';
export const Arbitrios = 'Arbitrios';
export const Multatributaria = '';
