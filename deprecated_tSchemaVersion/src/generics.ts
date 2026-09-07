export type NiceMerge<T, U, T0 = T & U, T1 = { [K in keyof T0]: T0[K] }> = T1
export type DeepWriteable<T> = {
  -readonly [P in keyof T]: DeepWriteable<T[P]>
}

export type NiceOmit<
  //
  T,
  K extends keyof T,
  T0 = Omit<T, K>,
  T1 = { [K in keyof T0]: T0[K] }
> = T1

export type NicePick<
  //
  T,
  K extends keyof T,
  T0 = Pick<T, K>,
  T1 = { [K in keyof T0]: T0[K] }
> = T1
