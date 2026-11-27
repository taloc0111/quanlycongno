import ServicePage from './modules/ServicePage';
import { debtsConfig } from './modules/serviceConfigs';

export default function DebtApp() {
  return <ServicePage config={debtsConfig} />;
}
