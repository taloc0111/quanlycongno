import ServicePage from './modules/ServicePage';
import { trainsConfig } from './modules/serviceConfigs';

export default function TrainApp() {
  return <ServicePage config={trainsConfig} />;
}
