// src/utils/patientData.ts
export async function fetchPatientData(apiUrl: string): Promise<string> {
    console.log('Fetching patient data from:', apiUrl); // Debug log
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch patient data: ${response.statusText}`);
      }
      const json = await response.json();
      const data = json?.data;
  
      if (!data) {
        throw new Error('Invalid patient data format');
      }
  
      console.log('Fetched patient data:', data); // Debug log
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Error fetching patient data:', error); // Debug log
      return 'Impossible de récupérer les données du patient.';
    }
  }