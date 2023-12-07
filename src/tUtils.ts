import { TObject } from './tsSchema'

// TODO: add unit tests

export const omitTObject = <
  TObj extends TObject,
  PropsToOmit extends (keyof TObj['properties'])[],
  NewProperties = Omit<TObj['properties'], PropsToOmit[number]>,
  NiceProperties = { [K in keyof NewProperties]: NewProperties[K] },
  Out = Omit<TObj, 'properties'> & {
    properties: NiceProperties
  },
  NiceOut = { [K in keyof Out]: Out[K] }
>(
  obj: TObj,
  attrsName: PropsToOmit
) => {
  const propertiesCopy = { ...obj.properties }
  attrsName.forEach(key => {
    // @ts-expect-error
    delete propertiesCopy[key]
  })

  const out = { ...obj, properties: propertiesCopy } as NiceOut
  return out
}

export const pickTObject = <
  TObj extends TObject,
  PropsToPick extends (keyof TObj['properties'])[],
  NewProperties = Pick<TObj['properties'], PropsToPick[number]>,
  NiceProperties = { [K in keyof NewProperties]: NewProperties[K] },
  Out = Omit<TObj, 'properties'> & {
    properties: NiceProperties
  },
  NiceOut = { [K in keyof Out]: Out[K] }
>(
  obj: TObj,
  ...attrsName: PropsToPick
) => {
  const propertiesCopy = {}
  attrsName.forEach(key => {
    // @ts-expect-error
    propertiesCopy[key] = obj.properties[key]
  })

  const out = { ...obj, properties: propertiesCopy } as NiceOut
  return out
}

export const tUtils = {
  pickTObject,
  omitTObject,
}
