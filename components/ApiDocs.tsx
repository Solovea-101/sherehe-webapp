'use client';

import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';
import { Loading } from './ui';

// Swagger UI is large and needs the browser, so it loads on demand and never during the build.
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false, loading: () => <Loading>Loading the API documentation...</Loading> });

/** Every endpoint, with request and response shapes, drawn from the same openapi.yaml the API is checked against. */
export function ApiDocs() {
  return <SwaggerUI url="/openapi.yaml" docExpansion="list" defaultModelsExpandDepth={1} />;
}
