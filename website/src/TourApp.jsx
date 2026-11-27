import ServicePage from './modules/ServicePage';
import { toursConfig } from './modules/serviceConfigs';

export default function TourApp() {
  return <ServicePage config={toursConfig} />;
}
