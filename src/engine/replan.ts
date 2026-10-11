import type { DeliveryPlan, Minutes } from '../types'
import type { World } from './disruptions'
import { NotImplementedError } from './errors'
/** TODO(dev B): replan from `now`. Completed stops stay fixed; remaining deliveries re-allocated respecting capacity + windows;
 *  unassignable deliveries get an explicit reason. Throws until implemented so no fake plan is ever returned. */
export function replan(_world: World, _current: DeliveryPlan, _now: Minutes): DeliveryPlan { throw new NotImplementedError('replan') }
