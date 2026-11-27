import ServicePage from './modules/ServicePage';
import { passportsConfig } from './modules/serviceConfigs';

export default function PassportApp() {
  return <ServicePage config={passportsConfig} />;
}
