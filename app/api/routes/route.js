import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Look for the dictionary file
    const filePath = path.join(process.cwd(), 'routes.json');
    
    // If missing, return empty (don't crash)
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({});
    }

    // Read and send the names
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);

    return NextResponse.json(data);

  } catch (error) {
    console.error("Route API Error:", error);
    return NextResponse.json({});
  }
}