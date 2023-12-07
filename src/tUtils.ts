import { T } from '.'
import { NiceMerge, NiceOmit, NicePick } from './generics'
import { TObject } from './tsSchema'

// TODO: add unit tests

export const omitTObject = <
  TObj extends TObject,
  PropsToOmit extends (keyof TObj['properties'])[],
  NewProperties = NiceOmit<TObj['properties'], PropsToOmit[number]>,
  Out = NiceMerge<Omit<TObj, 'properties'>, { properties: NewProperties }>
>(
  obj: TObj,
  ...attrsName: PropsToOmit
) => {
  const propertiesCopy = { ...obj.properties }
  attrsName.forEach(key => {
    // @ts-expect-error
    delete propertiesCopy[key]
  })

  const out = { ...obj, properties: propertiesCopy } as Out
  return out
}

export const pickTObject = <
  TObj extends TObject,
  PropsToPick extends (keyof TObj['properties'])[],
  NewProperties = NicePick<TObj['properties'], PropsToPick[number]>,
  Out = NiceMerge<Omit<TObj, 'properties'>, { properties: NewProperties }>
>(
  obj: TObj,
  ...attrsName: PropsToPick
) => {
  const propertiesCopy = {}
  attrsName.forEach(key => {
    // @ts-expect-error
    propertiesCopy[key] = obj.properties[key]
  })

  const out = { ...obj, properties: propertiesCopy } as Out
  return out
}

export const tUtils = {
  pickTObject,
  omitTObject,
}
