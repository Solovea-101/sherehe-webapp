import { ApiDocs } from '@/components/ApiDocs';
import { PageTitle } from '@/components/ui';

export const metadata = { title: 'API docs | Sherehe' };

export default function DocsPage() {
  return (
    <>
      <PageTitle intro={<>The contract Kazi Connect builds against. The raw file is at <a className="font-semibold text-brand underline-offset-2 hover:underline" href="/openapi.yaml">/openapi.yaml</a>.</>}>
        API documentation
      </PageTitle>
      <ApiDocs />
    </>
  );
}
